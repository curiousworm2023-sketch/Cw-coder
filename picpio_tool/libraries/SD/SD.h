// SD.h — PICPIO C driver for SD/SDHC cards over SPI with a minimal
// FAT16/FAT32 filesystem (8.3 short names, files in any directory path
// using '/' separators). Designed for data logging on PIC18/PIC24+.
//
// Wiring: card on the hardware SPI pins (SCK/MOSI/MISO), CS on any GPIO.
//   PIC18F27K40 default SPI: SCK=RC5, MOSI(SDO)=RC1, MISO(SDI)=RC2.
//
// RAM: ~1.1 KB (a 512-byte sector cache in SD_t + a 512-byte data buffer
// per open SD_File). Not for parts with <2 KB RAM.
//
// Usage:
//   SD_t sd; SD_File f;
//   void init() {
//       SPI.begin();
//       if (!SD_begin(&sd, D0)) { /* card/mount failed */ }
//       if (SD_open(&sd, &f, "LOG.CSV", SD_APPEND)) {
//           SD_print(&f, "hello,123\n");
//           SD_close(&f);
//       }
//   }
#ifndef PICPIO_SD_H
#define PICPIO_SD_H

#include "Picpio.h"

// Open modes
#define SD_READ    0   // read existing file
#define SD_WRITE   1   // create or truncate, then write from start
#define SD_APPEND  2   // create if missing, then write at end

// Card types
#define SD_CARD_NONE  0
#define SD_CARD_SD1   1
#define SD_CARD_SD2   2
#define SD_CARD_SDHC  3   // block-addressed

typedef struct {
    uint8_t  cs;                // chip-select GPIO pin
    uint8_t  cardType;          // SD_CARD_*
    uint8_t  fatType;           // 16 or 32
    uint8_t  sectorsPerCluster;
    uint8_t  numFats;
    uint16_t rootEntries;       // FAT16 root dir entry count (0 on FAT32)
    uint32_t fatStart;          // LBA of first FAT
    uint32_t fatSize;           // sectors per FAT
    uint32_t rootStart;         // FAT16: LBA of root dir; FAT32: root cluster
    uint32_t dataStart;         // LBA of cluster 2
    uint32_t totalClusters;
    uint8_t  buf[512];          // sector cache (FAT / directory access)
    uint32_t bufLba;            // LBA currently in buf (0xFFFFFFFF = empty)
    uint8_t  bufDirty;
} SD_t;

typedef struct {
    SD_t    *sd;
    uint8_t  mode;
    uint8_t  bufDirty;
    uint32_t dirLba;            // sector holding this file's 32-byte dir entry
    uint16_t dirOffset;         // byte offset of the dir entry within dirLba
    uint32_t firstCluster;      // first data cluster (0 = empty file)
    uint32_t curCluster;        // cluster mapped by buf
    uint32_t size;              // file length in bytes
    uint32_t pos;               // current read/write position
    uint8_t  buf[512];          // current data sector
    uint32_t bufLba;            // LBA currently in buf (0xFFFFFFFF = empty)
} SD_File;

// Initialise the card on chip-select pin `cs` and mount the first FAT
// partition. Call SPI.begin() first. Returns 1 on success.
uint8_t SD_begin(SD_t *dev, uint8_t cs);

// Open `path` (e.g. "LOG.CSV" or "DATA/LOG.CSV") in the given mode.
// Returns 1 on success. 8.3 names only; path components are uppercased.
uint8_t SD_open(SD_t *dev, SD_File *file, const char *path, uint8_t mode);

// Read up to `len` bytes into `dst`. Returns bytes actually read (0 at EOF).
uint16_t SD_read(SD_File *file, void *dst, uint16_t len);

// Write `len` bytes from `src`. Returns bytes written (short write = error).
uint16_t SD_write(SD_File *file, const void *src, uint16_t len);

// Convenience: write a NUL-terminated string. Returns bytes written.
uint16_t SD_print(SD_File *file, const char *s);

// Flush buffers and update the directory entry. Returns 1 on success.
uint8_t SD_close(SD_File *file);

// True if `path` exists.
uint8_t SD_exists(SD_t *dev, const char *path);

// Delete a file. Returns 1 on success.
uint8_t SD_remove(SD_t *dev, const char *path);

// Current file size / position helpers.
uint32_t SD_size(SD_File *file);
uint32_t SD_position(SD_File *file);
uint8_t  SD_seek(SD_File *file, uint32_t pos);   // read-mode seek; returns 1 if in range

#endif // PICPIO_SD_H
