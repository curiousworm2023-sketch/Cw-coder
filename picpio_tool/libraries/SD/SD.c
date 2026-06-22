// SD.c — SD/SDHC over SPI + minimal FAT16/FAT32 (see SD.h).
// Sector size is assumed 512 bytes (universal on SD cards).
#include "SD.h"

#define SD_NO_LBA   0xFFFFFFFFUL

// ── small helpers ────────────────────────────────────────────────────────────
static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | ((uint16_t)p[1] << 8)); }
static uint32_t rd32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static char sd_up(char c) { return (c >= 'a' && c <= 'z') ? (char)(c - 32) : c; }
static uint16_t sd_strlen(const char *s) { uint16_t n = 0; while (s[n]) n++; return n; }

// Build an 8.3 short name (11 bytes, space padded, no dot) from s[0..len).
static void sd_makeSN(const char *s, uint16_t len, char out[11]) {
    uint8_t i; for (i = 0; i < 11; i++) out[i] = ' ';
    uint16_t k = 0; uint8_t n = 0;
    while (k < len && s[k] != '.' && n < 8) out[n++] = sd_up(s[k++]);
    while (k < len && s[k] != '.') k++;
    if (k < len && s[k] == '.') { k++; n = 8; while (k < len && n < 11) out[n++] = sd_up(s[k++]); }
}

// ── SPI / card layer ─────────────────────────────────────────────────────────
static void sd_select(SD_t *sd)   { gpio_write(sd->cs, LOW); }
static void sd_deselect(SD_t *sd) { gpio_write(sd->cs, HIGH); SPI.transfer(0xFF); }

static uint8_t sd_cmd(SD_t *sd, uint8_t cmd, uint32_t arg) {
    SPI.transfer(0xFF);
    SPI.transfer((uint8_t)(0x40 | cmd));
    SPI.transfer((uint8_t)(arg >> 24));
    SPI.transfer((uint8_t)(arg >> 16));
    SPI.transfer((uint8_t)(arg >> 8));
    SPI.transfer((uint8_t)arg);
    uint8_t crc = 0xFF;
    if (cmd == 0) crc = 0x95;        // CMD0,  arg 0
    if (cmd == 8) crc = 0x87;        // CMD8,  arg 0x1AA
    SPI.transfer(crc);
    uint8_t r = 0xFF, i;
    for (i = 0; i < 16; i++) { r = SPI.transfer(0xFF); if (!(r & 0x80)) break; }
    return r;
}
static uint8_t sd_acmd(SD_t *sd, uint8_t cmd, uint32_t arg) {
    sd_cmd(sd, 55, 0);
    return sd_cmd(sd, cmd, arg);
}

static uint8_t sd_readBlock(SD_t *sd, uint32_t lba, uint8_t *dst) {
    uint32_t addr = (sd->cardType == SD_CARD_SDHC) ? lba : (lba << 9);
    sd_select(sd);
    if (sd_cmd(sd, 17, addr) != 0x00) { sd_deselect(sd); return 0; }
    uint8_t tok = 0xFF; uint16_t i;
    for (i = 0; i < 0xFFFF; i++) { tok = SPI.transfer(0xFF); if (tok != 0xFF) break; }
    if (tok != 0xFE) { sd_deselect(sd); return 0; }
    for (i = 0; i < 512; i++) dst[i] = SPI.transfer(0xFF);
    SPI.transfer(0xFF); SPI.transfer(0xFF);   // discard CRC
    sd_deselect(sd);
    return 1;
}

static uint8_t sd_writeBlock(SD_t *sd, uint32_t lba, const uint8_t *src) {
    uint32_t addr = (sd->cardType == SD_CARD_SDHC) ? lba : (lba << 9);
    sd_select(sd);
    if (sd_cmd(sd, 24, addr) != 0x00) { sd_deselect(sd); return 0; }
    SPI.transfer(0xFF);          // 1-byte gap
    SPI.transfer(0xFE);          // data start token
    uint16_t i;
    for (i = 0; i < 512; i++) SPI.transfer(src[i]);
    SPI.transfer(0xFF); SPI.transfer(0xFF);   // dummy CRC
    if ((SPI.transfer(0xFF) & 0x1F) != 0x05) { sd_deselect(sd); return 0; }  // not accepted
    for (i = 0; i < 0xFFFF; i++) { if (SPI.transfer(0xFF) != 0x00) break; }   // wait busy
    sd_deselect(sd);
    return 1;
}

// ── FAT geometry / mount ─────────────────────────────────────────────────────
static uint8_t sd_cacheFlush(SD_t *sd) {
    if (sd->bufDirty && sd->bufLba != SD_NO_LBA) {
        if (!sd_writeBlock(sd, sd->bufLba, sd->buf)) return 0;
        sd->bufDirty = 0;
    }
    return 1;
}
static uint8_t sd_cache(SD_t *sd, uint32_t lba) {
    if (sd->bufLba == lba) return 1;
    if (!sd_cacheFlush(sd)) return 0;
    if (!sd_readBlock(sd, lba, sd->buf)) { sd->bufLba = SD_NO_LBA; return 0; }
    sd->bufLba = lba;
    return 1;
}

static uint32_t sd_clusterLba(SD_t *sd, uint32_t cl) {
    return sd->dataStart + (cl - 2) * (uint32_t)sd->sectorsPerCluster;
}
static uint8_t sd_isEoc(SD_t *sd, uint32_t cl) {
    return (sd->fatType == 16) ? (cl >= 0xFFF8) : (cl >= 0x0FFFFFF8UL);
}
static uint32_t sd_fatGet(SD_t *sd, uint32_t cl) {
    uint32_t off = (sd->fatType == 16) ? cl * 2 : cl * 4;
    if (!sd_cache(sd, sd->fatStart + off / 512)) return SD_NO_LBA;
    uint16_t i = (uint16_t)(off % 512);
    if (sd->fatType == 16) return rd16(&sd->buf[i]);
    return rd32(&sd->buf[i]) & 0x0FFFFFFFUL;
}
static uint8_t sd_fatSet(SD_t *sd, uint32_t cl, uint32_t val) {
    uint32_t off = (sd->fatType == 16) ? cl * 2 : cl * 4;
    if (!sd_cache(sd, sd->fatStart + off / 512)) return 0;
    uint16_t i = (uint16_t)(off % 512);
    if (sd->fatType == 16) { sd->buf[i] = (uint8_t)val; sd->buf[i+1] = (uint8_t)(val >> 8); }
    else {
        sd->buf[i]   = (uint8_t)val;
        sd->buf[i+1] = (uint8_t)(val >> 8);
        sd->buf[i+2] = (uint8_t)(val >> 16);
        sd->buf[i+3] = (uint8_t)((sd->buf[i+3] & 0xF0) | ((val >> 24) & 0x0F));
    }
    sd->bufDirty = 1;
    return 1;
}

static void sd_zeroCluster(SD_t *sd, uint32_t cl) {
    sd_cacheFlush(sd);
    uint16_t i; for (i = 0; i < 512; i++) sd->buf[i] = 0;
    uint32_t lba = sd_clusterLba(sd, cl);
    uint8_t s; for (s = 0; s < sd->sectorsPerCluster; s++) sd_writeBlock(sd, lba + s, sd->buf);
    sd->bufLba = SD_NO_LBA; sd->bufDirty = 0;
}

// Allocate a free cluster, mark it EOC, and link `prev`->new if prev != 0.
static uint32_t sd_allocCluster(SD_t *sd, uint32_t prev) {
    uint32_t cl;
    for (cl = 2; cl < sd->totalClusters + 2; cl++) {
        if (sd_fatGet(sd, cl) == 0) {
            uint32_t eoc = (sd->fatType == 16) ? 0xFFFF : 0x0FFFFFFFUL;
            if (!sd_fatSet(sd, cl, eoc)) return 0;
            if (prev) sd_fatSet(sd, prev, cl);
            return cl;
        }
    }
    return 0;   // disk full
}
static void sd_freeChain(SD_t *sd, uint32_t cl) {
    while (cl >= 2 && !sd_isEoc(sd, cl)) {
        uint32_t nxt = sd_fatGet(sd, cl);
        sd_fatSet(sd, cl, 0);
        cl = nxt;
    }
}

static uint8_t sd_mount(SD_t *sd) {
    uint32_t partLba = 0;
    if (!sd_readBlock(sd, 0, sd->buf)) return 0;
    sd->bufLba = 0; sd->bufDirty = 0;
    if (sd->buf[510] == 0x55 && sd->buf[511] == 0xAA &&
        sd->buf[0] != 0xEB && sd->buf[0] != 0xE9) {
        partLba = rd32(&sd->buf[0x1BE + 8]);     // MBR: first partition's start LBA
    }
    if (!sd_cache(sd, partLba)) return 0;
    uint8_t *b = sd->buf;
    if (rd16(&b[11]) != 512) return 0;            // bytes/sector
    sd->sectorsPerCluster = b[13];
    if (sd->sectorsPerCluster == 0) return 0;
    uint16_t reserved = rd16(&b[14]);
    sd->numFats     = b[16];
    sd->rootEntries = rd16(&b[17]);
    uint32_t totalSec = rd16(&b[19]); if (totalSec == 0) totalSec = rd32(&b[32]);
    uint32_t fatSize  = rd16(&b[22]); if (fatSize  == 0) fatSize  = rd32(&b[36]);
    sd->fatSize  = fatSize;
    sd->fatStart = partLba + reserved;
    uint32_t rootDirSectors = ((uint32_t)sd->rootEntries * 32 + 511) / 512;
    sd->dataStart = partLba + reserved + (uint32_t)sd->numFats * fatSize + rootDirSectors;
    uint32_t dataSec = totalSec - (reserved + (uint32_t)sd->numFats * fatSize + rootDirSectors);
    sd->totalClusters = dataSec / sd->sectorsPerCluster;
    if (sd->totalClusters < 4085)       return 0;   // FAT12 unsupported
    else if (sd->totalClusters < 65525) { sd->fatType = 16; sd->rootStart = partLba + reserved + (uint32_t)sd->numFats * fatSize; }
    else                                { sd->fatType = 32; sd->rootStart = rd32(&b[44]); }
    return 1;
}

// ── directory traversal ──────────────────────────────────────────────────────
// LBA of the n-th sector (0-based) of directory `dirCluster` (0 = root). For
// cluster dirs, follows/grows the chain when `grow`. Returns SD_NO_LBA at end.
static uint32_t sd_dirSectorLba(SD_t *sd, uint32_t dirCluster, uint32_t n, uint8_t grow) {
    if (dirCluster == 0 && sd->fatType != 32) {           // fixed FAT16 root
        if (n >= ((uint32_t)sd->rootEntries * 32 + 511) / 512) return SD_NO_LBA;
        return sd->rootStart + n;
    }
    uint32_t cl  = (dirCluster == 0) ? sd->rootStart : dirCluster;   // FAT32 root cluster
    uint32_t spc = sd->sectorsPerCluster;
    uint32_t clusterIdx = n / spc, secInClus = n % spc;
    while (clusterIdx > 0) {
        uint32_t nxt = sd_fatGet(sd, cl);
        if (nxt < 2 || sd_isEoc(sd, nxt)) {
            if (!grow) return SD_NO_LBA;
            nxt = sd_allocCluster(sd, cl);
            if (!nxt) return SD_NO_LBA;
            sd_zeroCluster(sd, nxt);
        }
        cl = nxt; clusterIdx--;
    }
    return sd_clusterLba(sd, cl) + secInClus;
}

static uint8_t sd_dirFind(SD_t *sd, uint32_t dirCluster, const char sn[11],
                          uint32_t *entLba, uint16_t *entOff,
                          uint32_t *firstClus, uint32_t *size, uint8_t *attr) {
    uint32_t n = 0;
    for (;;) {
        uint32_t lba = sd_dirSectorLba(sd, dirCluster, n, 0);
        if (lba == SD_NO_LBA) return 0;
        if (!sd_cache(sd, lba)) return 0;
        uint16_t o;
        for (o = 0; o < 512; o += 32) {
            uint8_t f0 = sd->buf[o];
            if (f0 == 0x00) return 0;                 // end of directory
            if (f0 == 0xE5) continue;                 // deleted
            if (sd->buf[o + 11] == 0x0F) continue;    // long-name entry
            uint8_t k, match = 1;
            for (k = 0; k < 11; k++) if (sd->buf[o + k] != (uint8_t)sn[k]) { match = 0; break; }
            if (match) {
                if (entLba)    *entLba = lba;
                if (entOff)    *entOff = o;
                if (firstClus) *firstClus = ((uint32_t)rd16(&sd->buf[o + 20]) << 16) | rd16(&sd->buf[o + 26]);
                if (size)      *size = rd32(&sd->buf[o + 28]);
                if (attr)      *attr = sd->buf[o + 11];
                return 1;
            }
        }
        n++;
    }
}

static uint8_t sd_dirCreate(SD_t *sd, uint32_t dirCluster, const char sn[11],
                            uint32_t *entLba, uint16_t *entOff) {
    uint32_t n = 0;
    for (;;) {
        uint32_t lba = sd_dirSectorLba(sd, dirCluster, n, 1);
        if (lba == SD_NO_LBA) return 0;
        if (!sd_cache(sd, lba)) return 0;
        uint16_t o;
        for (o = 0; o < 512; o += 32) {
            uint8_t f0 = sd->buf[o];
            if (f0 == 0x00 || f0 == 0xE5) {
                uint8_t k;
                for (k = 0; k < 11; k++) sd->buf[o + k] = (uint8_t)sn[k];
                sd->buf[o + 11] = 0x20;                // archive attribute
                for (k = 12; k < 32; k++) sd->buf[o + k] = 0;
                sd->bufDirty = 1;
                if (entLba) *entLba = lba;
                if (entOff) *entOff = o;
                return 1;
            }
        }
        n++;
    }
}

// Resolve all but the last path component to a directory cluster (0 = root);
// *leaf points at the final (file) component. Intermediate dirs must exist.
static uint8_t sd_resolveParent(SD_t *sd, const char *path, uint32_t *dirCluster, const char **leaf) {
    *dirCluster = 0;
    const char *seg = path;
    for (;;) {
        const char *slash = seg;
        while (*slash && *slash != '/') slash++;
        if (*slash == 0) { *leaf = seg; return 1; }
        char sn[11]; sd_makeSN(seg, (uint16_t)(slash - seg), sn);
        uint32_t fc; uint8_t attr;
        if (!sd_dirFind(sd, *dirCluster, sn, 0, 0, &fc, 0, &attr)) return 0;
        if (!(attr & 0x10)) return 0;                 // not a directory
        *dirCluster = fc;
        seg = slash + 1;
    }
}

static uint8_t sd_dirWriteMeta(SD_File *f) {
    SD_t *sd = f->sd;
    if (!sd_cache(sd, f->dirLba)) return 0;
    uint16_t o = f->dirOffset;
    sd->buf[o + 20] = (uint8_t)(f->firstCluster >> 16);
    sd->buf[o + 21] = (uint8_t)(f->firstCluster >> 24);
    sd->buf[o + 26] = (uint8_t)(f->firstCluster);
    sd->buf[o + 27] = (uint8_t)(f->firstCluster >> 8);
    sd->buf[o + 28] = (uint8_t)(f->size);
    sd->buf[o + 29] = (uint8_t)(f->size >> 8);
    sd->buf[o + 30] = (uint8_t)(f->size >> 16);
    sd->buf[o + 31] = (uint8_t)(f->size >> 24);
    sd->bufDirty = 1;
    return 1;
}

// ── file data buffer ─────────────────────────────────────────────────────────
static uint8_t sd_fileFlush(SD_File *f) {
    if (f->bufDirty && f->bufLba != SD_NO_LBA) {
        if (!sd_writeBlock(f->sd, f->bufLba, f->buf)) return 0;
        f->bufDirty = 0;
    }
    return 1;
}
static uint8_t sd_fileLoad(SD_File *f, uint32_t lba) {
    if (f->bufLba == lba) return 1;
    if (!sd_fileFlush(f)) return 0;
    if (!sd_readBlock(f->sd, lba, f->buf)) { f->bufLba = SD_NO_LBA; return 0; }
    f->bufLba = lba;
    return 1;
}

// LBA for byte offset `pos`, allocating clusters when `grow`. SD_NO_LBA on fail.
static uint32_t sd_fileLba(SD_File *f, uint32_t pos, uint8_t grow) {
    SD_t *sd = f->sd;
    uint32_t spc = sd->sectorsPerCluster;
    uint32_t clusterIdx = pos / (512UL * spc);
    uint16_t secInClus  = (uint16_t)((pos / 512) % spc);
    uint32_t cl = f->firstCluster;
    if (cl < 2) {
        if (!grow) return SD_NO_LBA;
        cl = sd_allocCluster(sd, 0);
        if (!cl) return SD_NO_LBA;
        f->firstCluster = cl;
    }
    uint32_t idx = 0;
    while (idx < clusterIdx) {
        uint32_t nxt = sd_fatGet(sd, cl);
        if (nxt < 2 || sd_isEoc(sd, nxt)) {
            if (!grow) return SD_NO_LBA;
            nxt = sd_allocCluster(sd, cl);
            if (!nxt) return SD_NO_LBA;
        }
        cl = nxt; idx++;
    }
    return sd_clusterLba(sd, cl) + secInClus;
}

// ── public API ───────────────────────────────────────────────────────────────
uint8_t SD_begin(SD_t *sd, uint8_t cs) {
    sd->cs = cs;
    sd->cardType = SD_CARD_NONE;
    sd->bufLba = SD_NO_LBA;
    sd->bufDirty = 0;
    gpio_mode(cs, GPIO_OUT);
    gpio_write(cs, HIGH);

    SPI.setClockDivider(SPI_CLOCK_DIV128);          // slow clock for init
    uint8_t i; for (i = 0; i < 10; i++) SPI.transfer(0xFF);   // 80 clocks, CS high

    sd_select(sd);
    uint8_t r = 0xFF; uint16_t t;
    for (t = 0; t < 200; t++) { r = sd_cmd(sd, 0, 0); if (r == 0x01) break; }
    if (r != 0x01) { sd_deselect(sd); return 0; }

    r = sd_cmd(sd, 8, 0x000001AAUL);
    if (r == 0x01) {                                 // SD v2
        uint8_t r7[4]; for (i = 0; i < 4; i++) r7[i] = SPI.transfer(0xFF);
        if (r7[2] != 0x01 || r7[3] != 0xAA) { sd_deselect(sd); return 0; }
        for (t = 0; t < 0xFFFF; t++) { r = sd_acmd(sd, 41, 0x40000000UL); if (r == 0x00) break; }
        if (r != 0x00) { sd_deselect(sd); return 0; }
        r = sd_cmd(sd, 58, 0);                        // read OCR
        uint8_t ocr0 = SPI.transfer(0xFF);
        SPI.transfer(0xFF); SPI.transfer(0xFF); SPI.transfer(0xFF);
        sd->cardType = (ocr0 & 0x40) ? SD_CARD_SDHC : SD_CARD_SD2;
    } else {                                         // SD v1 / MMC
        for (t = 0; t < 0xFFFF; t++) { r = sd_acmd(sd, 41, 0); if (r == 0x00 || (r & 0x04)) break; }
        if (r != 0x00) {
            for (t = 0; t < 0xFFFF; t++) { r = sd_cmd(sd, 1, 0); if (r == 0x00) break; }
            if (r != 0x00) { sd_deselect(sd); return 0; }
        }
        sd->cardType = SD_CARD_SD1;
    }
    if (sd->cardType != SD_CARD_SDHC) sd_cmd(sd, 16, 512);   // 512-byte blocks
    sd_deselect(sd);

    SPI.setClockDivider(SPI_CLOCK_DIV4);            // run fast after init
    return sd_mount(sd);
}

uint8_t SD_open(SD_t *sd, SD_File *f, const char *path, uint8_t mode) {
    uint32_t dirCluster; const char *leaf;
    if (!sd_resolveParent(sd, path, &dirCluster, &leaf)) return 0;
    char sn[11]; sd_makeSN(leaf, sd_strlen(leaf), sn);

    f->sd = sd; f->mode = mode; f->bufDirty = 0; f->bufLba = SD_NO_LBA;
    f->pos = 0; f->curCluster = 0;

    uint32_t entLba, fc, sz; uint16_t entOff; uint8_t attr;
    uint8_t exists = sd_dirFind(sd, dirCluster, sn, &entLba, &entOff, &fc, &sz, &attr);
    if (exists && (attr & 0x10)) return 0;           // it's a directory

    if (!exists) {
        if (mode == SD_READ) return 0;
        if (!sd_dirCreate(sd, dirCluster, sn, &entLba, &entOff)) return 0;
        fc = 0; sz = 0;
    }
    f->dirLba = entLba; f->dirOffset = entOff;
    f->firstCluster = fc; f->size = sz;

    if (mode == SD_WRITE && exists) {                // truncate
        if (fc >= 2) sd_freeChain(sd, fc);
        f->firstCluster = 0; f->size = 0;
        if (!sd_dirWriteMeta(f)) return 0;
    }
    if (mode == SD_APPEND) f->pos = f->size;
    f->curCluster = f->firstCluster;
    return sd_cacheFlush(sd);
}

uint16_t SD_read(SD_File *f, void *dst, uint16_t len) {
    uint8_t *d = (uint8_t *)dst; uint16_t done = 0;
    while (done < len && f->pos < f->size) {
        uint32_t lba = sd_fileLba(f, f->pos, 0);
        if (lba == SD_NO_LBA || !sd_fileLoad(f, lba)) break;
        uint16_t off = (uint16_t)(f->pos % 512);
        uint32_t remain = f->size - f->pos;
        uint16_t n = (uint16_t)(512 - off);
        if (n > (uint16_t)(len - done)) n = (uint16_t)(len - done);
        if ((uint32_t)n > remain) n = (uint16_t)remain;
        uint16_t i; for (i = 0; i < n; i++) d[done + i] = f->buf[off + i];
        f->pos += n; done += n;
    }
    return done;
}

uint16_t SD_write(SD_File *f, const void *src, uint16_t len) {
    if (f->mode == SD_READ) return 0;
    const uint8_t *s = (const uint8_t *)src; uint16_t done = 0;
    while (done < len) {
        uint32_t lba = sd_fileLba(f, f->pos, 1);
        if (lba == SD_NO_LBA || !sd_fileLoad(f, lba)) break;
        uint16_t off = (uint16_t)(f->pos % 512);
        uint16_t n = (uint16_t)(512 - off);
        if (n > (uint16_t)(len - done)) n = (uint16_t)(len - done);
        uint16_t i; for (i = 0; i < n; i++) f->buf[off + i] = s[done + i];
        f->bufDirty = 1;
        f->pos += n; done += n;
        if (f->pos > f->size) f->size = f->pos;
    }
    return done;
}

uint16_t SD_print(SD_File *f, const char *str) {
    return SD_write(f, str, sd_strlen(str));
}

uint8_t SD_close(SD_File *f) {
    uint8_t ok = 1;
    if (f->mode != SD_READ) {
        if (!sd_fileFlush(f))      ok = 0;
        if (!sd_dirWriteMeta(f))   ok = 0;
        if (!sd_cacheFlush(f->sd)) ok = 0;
    }
    f->bufLba = SD_NO_LBA;
    return ok;
}

uint8_t SD_exists(SD_t *sd, const char *path) {
    uint32_t dirCluster; const char *leaf;
    if (!sd_resolveParent(sd, path, &dirCluster, &leaf)) return 0;
    char sn[11]; sd_makeSN(leaf, sd_strlen(leaf), sn);
    return sd_dirFind(sd, dirCluster, sn, 0, 0, 0, 0, 0);
}

uint8_t SD_remove(SD_t *sd, const char *path) {
    uint32_t dirCluster; const char *leaf;
    if (!sd_resolveParent(sd, path, &dirCluster, &leaf)) return 0;
    char sn[11]; sd_makeSN(leaf, sd_strlen(leaf), sn);
    uint32_t entLba, fc; uint16_t entOff; uint8_t attr;
    if (!sd_dirFind(sd, dirCluster, sn, &entLba, &entOff, &fc, 0, &attr)) return 0;
    if (attr & 0x10) return 0;                        // refuse directories
    if (fc >= 2) sd_freeChain(sd, fc);
    if (!sd_cache(sd, entLba)) return 0;
    sd->buf[entOff] = 0xE5;                            // mark deleted
    sd->bufDirty = 1;
    return sd_cacheFlush(sd);
}

uint32_t SD_size(SD_File *f)     { return f->size; }
uint32_t SD_position(SD_File *f) { return f->pos; }
uint8_t  SD_seek(SD_File *f, uint32_t pos) {
    if (pos > f->size) return 0;
    f->pos = pos;
    return 1;
}
