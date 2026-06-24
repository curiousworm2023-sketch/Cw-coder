// W5500.c — WIZnet W5500 SPI Ethernet driver (see W5500.h).
//
// Uses the W5500 Variable Data Length Mode (VDM) SPI frame:
//   [addr_hi][addr_lo][control][data...]
// where control = (BlockSelect << 3) | (RWB << 2) | OM(=0 for VDM).
// Socket TX/RX buffers are read/written at the buffer-block address equal to
// the socket's current write/read pointer — the W5500 wraps the 2 KB ring
// internally, so no manual ring arithmetic is needed.
#include "W5500.h"

// ── Common register addresses ───────────────────────────────────────────────
#define W5500_MR        0x0000   // Mode (bit7 = software reset)
#define W5500_GAR       0x0001   // Gateway IP (4)
#define W5500_SUBR      0x0005   // Subnet mask (4)
#define W5500_SHAR      0x0009   // Source MAC (6)
#define W5500_SIPR      0x000F   // Source IP (4)
#define W5500_PHYCFGR   0x002E   // PHY config/status (bit0 = link up)
#define W5500_VERSIONR  0x0039   // Chip version (always 0x04)

// ── Socket register addresses (within a socket's register block) ────────────
#define W5500_Sn_MR     0x0000
#define W5500_Sn_CR     0x0001
#define W5500_Sn_IR     0x0002
#define W5500_Sn_SR     0x0003
#define W5500_Sn_PORT   0x0004   // (2) local port
#define W5500_Sn_DIPR   0x000C   // (4) dest IP
#define W5500_Sn_DPORT  0x0010   // (2) dest port
#define W5500_Sn_TX_FSR 0x0020   // (2) TX free size
#define W5500_Sn_TX_WR  0x0024   // (2) TX write pointer
#define W5500_Sn_RX_RSR 0x0026   // (2) RX received size
#define W5500_Sn_RX_RD  0x0028   // (2) RX read pointer

// Socket commands (Sn_CR)
#define W5500_CR_OPEN    0x01
#define W5500_CR_LISTEN  0x02
#define W5500_CR_CONNECT 0x04
#define W5500_CR_DISCON  0x08
#define W5500_CR_CLOSE   0x10
#define W5500_CR_SEND    0x20
#define W5500_CR_RECV    0x40

// Socket interrupt bits (Sn_IR)
#define W5500_IR_SENDOK  0x10
#define W5500_IR_TIMEOUT 0x08
#define W5500_IR_RECV    0x04

// Block-select values for the control byte (before the <<3 shift).
#define W5500_BSB_COMMON     0x00
#define W5500_BSB_SOCK_REG(n) (uint8_t)(((n) << 2) | 0x01)
#define W5500_BSB_SOCK_TX(n)  (uint8_t)(((n) << 2) | 0x02)
#define W5500_BSB_SOCK_RX(n)  (uint8_t)(((n) << 2) | 0x03)

// ── Low-level SPI register access ────────────────────────────────────────────
static void w_writeBlock(W5500_t *d, uint16_t addr, uint8_t bsb,
                         const uint8_t *data, uint16_t len) {
    gpio_write(d->cs, LOW);
    SPI.transfer((uint8_t)(addr >> 8));
    SPI.transfer((uint8_t)addr);
    SPI.transfer((uint8_t)((bsb << 3) | 0x04));   // RWB=1 (write), OM=0 (VDM)
    while (len--) SPI.transfer(*data++);
    gpio_write(d->cs, HIGH);
}

static void w_readBlock(W5500_t *d, uint16_t addr, uint8_t bsb,
                        uint8_t *data, uint16_t len) {
    gpio_write(d->cs, LOW);
    SPI.transfer((uint8_t)(addr >> 8));
    SPI.transfer((uint8_t)addr);
    SPI.transfer((uint8_t)(bsb << 3));            // RWB=0 (read), OM=0 (VDM)
    while (len--) *data++ = SPI.transfer(0xFF);
    gpio_write(d->cs, HIGH);
}

static void    w_w8(W5500_t *d, uint16_t a, uint8_t bsb, uint8_t v)  { w_writeBlock(d, a, bsb, &v, 1); }
static uint8_t w_r8(W5500_t *d, uint16_t a, uint8_t bsb)            { uint8_t v; w_readBlock(d, a, bsb, &v, 1); return v; }
static void    w_w16(W5500_t *d, uint16_t a, uint8_t bsb, uint16_t v) {
    uint8_t b[2] = { (uint8_t)(v >> 8), (uint8_t)v };
    w_writeBlock(d, a, bsb, b, 2);
}
static uint16_t w_r16(W5500_t *d, uint16_t a, uint8_t bsb) {
    uint8_t b[2]; w_readBlock(d, a, bsb, b, 2);
    return (uint16_t)(((uint16_t)b[0] << 8) | b[1]);
}

// Issue a socket command and wait (bounded) for the W5500 to accept it.
static void w_cmd(W5500_t *d, uint8_t sock, uint8_t cmd) {
    uint8_t reg = W5500_BSB_SOCK_REG(sock);
    w_w8(d, W5500_Sn_CR, reg, cmd);
    uint16_t guard = 0;
    while (w_r8(d, W5500_Sn_CR, reg)) { if (++guard == 0) break; }
}

// Read a 16-bit "size" register that can change mid-read; sample until stable.
static uint16_t w_readSize(W5500_t *d, uint16_t addr, uint8_t reg) {
    uint16_t a = w_r16(d, addr, reg);
    uint8_t tries = 0;
    for (;;) {
        uint16_t b = w_r16(d, addr, reg);
        if (a == b || ++tries >= 4) return b;
        a = b;
    }
}

// ── Public API ───────────────────────────────────────────────────────────────
uint8_t W5500_version(W5500_t *dev, uint8_t cs) {
    dev->cs = cs;
    gpio_mode(cs, GPIO_OUT);
    gpio_write(cs, HIGH);
    return w_r8(dev, W5500_VERSIONR, W5500_BSB_COMMON);
}

uint8_t W5500_begin(W5500_t *dev, uint8_t cs,
                    const uint8_t mac[6], const uint8_t ip[4],
                    const uint8_t subnet[4], const uint8_t gateway[4]) {
    dev->cs = cs;
    dev->srcPort = 50000;
    gpio_mode(cs, GPIO_OUT);
    gpio_write(cs, HIGH);

    // Use a conservative SPI clock for init (breadboard-friendly); the W5500
    // itself is fine much faster, but slow is more tolerant of wiring.
    SPI.setClockDivider(SPI_CLOCK_DIV16);
    sys_delay(50);                          // let the module's supply/PHY settle

    // Software reset, then wait for the reset bit to self-clear (bounded).
    w_w8(dev, W5500_MR, W5500_BSB_COMMON, 0x80);
    sys_delay(2);
    uint16_t guard = 0;
    while ((w_r8(dev, W5500_MR, W5500_BSB_COMMON) & 0x80)) { if (++guard == 0) break; }
    sys_delay(2);

    if (w_r8(dev, W5500_VERSIONR, W5500_BSB_COMMON) != 0x04) return 0;  // no chip

    w_writeBlock(dev, W5500_SHAR, W5500_BSB_COMMON, mac, 6);
    w_writeBlock(dev, W5500_SIPR, W5500_BSB_COMMON, ip, 4);
    w_writeBlock(dev, W5500_SUBR, W5500_BSB_COMMON, subnet, 4);
    w_writeBlock(dev, W5500_GAR,  W5500_BSB_COMMON, gateway, 4);
    return 1;
}

uint8_t W5500_linkUp(W5500_t *dev) {
    return (uint8_t)(w_r8(dev, W5500_PHYCFGR, W5500_BSB_COMMON) & 0x01);
}

uint8_t W5500_status(W5500_t *dev, uint8_t sock) {
    return w_r8(dev, W5500_Sn_SR, W5500_BSB_SOCK_REG(sock));
}

// Open a socket in the given protocol mode on the given local port.
static uint8_t w_open(W5500_t *dev, uint8_t sock, uint8_t mode, uint16_t port) {
    uint8_t reg = W5500_BSB_SOCK_REG(sock);
    w_cmd(dev, sock, W5500_CR_CLOSE);
    w_w8(dev, W5500_Sn_IR, reg, 0xFF);              // clear all interrupts
    w_w8(dev, W5500_Sn_MR, reg, mode);
    w_w16(dev, W5500_Sn_PORT, reg, port);
    w_cmd(dev, sock, W5500_CR_OPEN);
    return W5500_status(dev, sock);
}

uint8_t W5500_connect(W5500_t *dev, uint8_t sock, const uint8_t ip[4], uint16_t port) {
    uint8_t reg = W5500_BSB_SOCK_REG(sock);
    if (w_open(dev, sock, W5500_MR_TCP, dev->srcPort++) != W5500_SOCK_INIT) return 0;

    w_writeBlock(dev, W5500_Sn_DIPR, reg, ip, 4);
    w_w16(dev, W5500_Sn_DPORT, reg, port);
    w_cmd(dev, sock, W5500_CR_CONNECT);

    // Wait (bounded) for the 3-way handshake to complete or fail.
    uint16_t guard = 0;
    for (;;) {
        uint8_t s = W5500_status(dev, sock);
        if (s == W5500_SOCK_ESTABLISHED) return 1;
        if (s == W5500_SOCK_CLOSED)      return 0;
        if (++guard == 0)                return 0;
    }
}

uint8_t W5500_listen(W5500_t *dev, uint8_t sock, uint16_t port) {
    if (w_open(dev, sock, W5500_MR_TCP, port) != W5500_SOCK_INIT) return 0;
    w_cmd(dev, sock, W5500_CR_LISTEN);
    return (uint8_t)(W5500_status(dev, sock) == W5500_SOCK_LISTEN);
}

uint8_t W5500_connected(W5500_t *dev, uint8_t sock) {
    return (uint8_t)(W5500_status(dev, sock) == W5500_SOCK_ESTABLISHED);
}

uint16_t W5500_available(W5500_t *dev, uint8_t sock) {
    return w_readSize(dev, W5500_Sn_RX_RSR, W5500_BSB_SOCK_REG(sock));
}

uint16_t W5500_send(W5500_t *dev, uint8_t sock, const uint8_t *buf, uint16_t len) {
    if (!len) return 0;
    uint8_t reg = W5500_BSB_SOCK_REG(sock);

    // Wait (bounded) for enough TX free space.
    uint16_t guard = 0, free;
    do {
        free = w_readSize(dev, W5500_Sn_TX_FSR, reg);
        if (W5500_status(dev, sock) == W5500_SOCK_CLOSED) return 0;
    } while (free < len && ++guard != 0);
    if (free < len) len = free;
    if (!len) return 0;

    uint16_t ptr = w_r16(dev, W5500_Sn_TX_WR, reg);
    w_writeBlock(dev, ptr, W5500_BSB_SOCK_TX(sock), buf, len);   // VDM ring auto-wraps
    w_w16(dev, W5500_Sn_TX_WR, reg, (uint16_t)(ptr + len));
    w_cmd(dev, sock, W5500_CR_SEND);

    // Wait (bounded) for SENDOK.
    guard = 0;
    for (;;) {
        uint8_t ir = w_r8(dev, W5500_Sn_IR, reg);
        if (ir & W5500_IR_SENDOK)  { w_w8(dev, W5500_Sn_IR, reg, W5500_IR_SENDOK); break; }
        if (ir & W5500_IR_TIMEOUT) { w_w8(dev, W5500_Sn_IR, reg, W5500_IR_TIMEOUT); return 0; }
        if (++guard == 0) break;
    }
    return len;
}

uint16_t W5500_recv(W5500_t *dev, uint8_t sock, uint8_t *buf, uint16_t len) {
    uint8_t reg = W5500_BSB_SOCK_REG(sock);
    uint16_t avail = w_readSize(dev, W5500_Sn_RX_RSR, reg);
    if (!avail) return 0;
    if (len > avail) len = avail;

    uint16_t ptr = w_r16(dev, W5500_Sn_RX_RD, reg);
    w_readBlock(dev, ptr, W5500_BSB_SOCK_RX(sock), buf, len);     // VDM ring auto-wraps
    w_w16(dev, W5500_Sn_RX_RD, reg, (uint16_t)(ptr + len));
    w_cmd(dev, sock, W5500_CR_RECV);
    return len;
}

void W5500_close(W5500_t *dev, uint8_t sock) {
    if (W5500_status(dev, sock) == W5500_SOCK_ESTABLISHED)
        w_cmd(dev, sock, W5500_CR_DISCON);
    w_cmd(dev, sock, W5500_CR_CLOSE);
    w_w8(dev, W5500_Sn_IR, W5500_BSB_SOCK_REG(sock), 0xFF);
}

// ── UDP ────────────────────────────────────────────────────────────────────
uint8_t W5500_udpBegin(W5500_t *dev, uint8_t sock, uint16_t port) {
    return (uint8_t)(w_open(dev, sock, W5500_MR_UDP, port) == W5500_SOCK_UDP);
}

uint16_t W5500_udpSend(W5500_t *dev, uint8_t sock, const uint8_t ip[4],
                       uint16_t port, const uint8_t *buf, uint16_t len) {
    if (!len) return 0;
    uint8_t reg = W5500_BSB_SOCK_REG(sock);

    w_writeBlock(dev, W5500_Sn_DIPR, reg, ip, 4);
    w_w16(dev, W5500_Sn_DPORT, reg, port);

    uint16_t ptr = w_r16(dev, W5500_Sn_TX_WR, reg);
    w_writeBlock(dev, ptr, W5500_BSB_SOCK_TX(sock), buf, len);
    w_w16(dev, W5500_Sn_TX_WR, reg, (uint16_t)(ptr + len));
    w_cmd(dev, sock, W5500_CR_SEND);

    uint16_t guard = 0;
    for (;;) {
        uint8_t ir = w_r8(dev, W5500_Sn_IR, reg);
        if (ir & W5500_IR_SENDOK)  { w_w8(dev, W5500_Sn_IR, reg, W5500_IR_SENDOK); break; }
        if (ir & W5500_IR_TIMEOUT) { w_w8(dev, W5500_Sn_IR, reg, W5500_IR_TIMEOUT); return 0; }
        if (++guard == 0) break;
    }
    return len;
}

uint16_t W5500_udpRecv(W5500_t *dev, uint8_t sock, uint8_t *srcip,
                       uint16_t *srcport, uint8_t *buf, uint16_t len) {
    uint8_t reg = W5500_BSB_SOCK_REG(sock);
    uint16_t avail = w_readSize(dev, W5500_Sn_RX_RSR, reg);
    if (avail < 8) return 0;   // need at least the 8-byte UDP packet header

    uint16_t ptr = w_r16(dev, W5500_Sn_RX_RD, reg);

    // UDP RX packet header: src IP (4), src port (2), data length (2).
    uint8_t hdr[8];
    w_readBlock(dev, ptr, W5500_BSB_SOCK_RX(sock), hdr, 8);
    ptr += 8;
    if (srcip)   { srcip[0] = hdr[0]; srcip[1] = hdr[1]; srcip[2] = hdr[2]; srcip[3] = hdr[3]; }
    if (srcport) *srcport = (uint16_t)(((uint16_t)hdr[4] << 8) | hdr[5]);
    uint16_t dlen = (uint16_t)(((uint16_t)hdr[6] << 8) | hdr[7]);

    uint16_t n = dlen;
    if (n > len) n = len;
    w_readBlock(dev, ptr, W5500_BSB_SOCK_RX(sock), buf, n);

    // Advance the read pointer past the whole datagram (header + payload) and
    // ack with RECV so the W5500 frees the buffer.
    w_w16(dev, W5500_Sn_RX_RD, reg, (uint16_t)(ptr + dlen));
    w_cmd(dev, sock, W5500_CR_RECV);
    return n;
}
