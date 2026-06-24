// W5500.h — PICPIO C driver for the WIZnet W5500 hardwired-TCP/IP Ethernet
// controller over SPI. Supports TCP (client + server) and UDP on up to 8
// sockets, using the W5500's Variable Data Length (VDM) SPI frames.
//
// Wiring: W5500 on the hardware SPI pins (SCK/MOSI/MISO), CS on any GPIO.
//   PIC18F27K40 default SPI: SCK=RC5, MOSI(SDO)=RC1, MISO(SDI)=RC2.
//   Tie the W5500 RST pin high (or to a GPIO) and give it a solid 3.3V supply.
//
// All multi-byte values (IP/MAC) are plain byte arrays in network order, e.g.
//   uint8_t ip[4] = {192,168,1,50};   uint8_t mac[6] = {0xDE,0xAD,...};
//
// Usage (TCP client):
//   W5500_t eth;
//   uint8_t mac[6]={0xDE,0xAD,0xBE,0xEF,0x00,0x01};
//   uint8_t ip[4]={192,168,1,50}, sn[4]={255,255,255,0}, gw[4]={192,168,1,1};
//   void init() {
//       SPI.begin();
//       if (!W5500_begin(&eth, D0, mac, ip, sn, gw)) { /* no chip */ }
//   }
//   void run() {
//       uint8_t host[4]={192,168,1,10};
//       if (W5500_connect(&eth, 0, host, 80)) {
//           W5500_send(&eth, 0, (const uint8_t*)"GET /\r\n\r\n", 9);
//           uint8_t buf[64]; uint16_t n = W5500_recv(&eth, 0, buf, sizeof buf);
//           W5500_close(&eth, 0);
//       }
//   }
#ifndef PICPIO_W5500_H
#define PICPIO_W5500_H

#include "Picpio.h"

// Socket protocol modes (Sn_MR)
#define W5500_MR_CLOSE   0x00
#define W5500_MR_TCP     0x01
#define W5500_MR_UDP     0x02
#define W5500_MR_MACRAW  0x04

// Socket status values (Sn_SR), as returned by W5500_status()
#define W5500_SOCK_CLOSED      0x00
#define W5500_SOCK_INIT        0x13
#define W5500_SOCK_LISTEN      0x14
#define W5500_SOCK_SYNSENT     0x15
#define W5500_SOCK_ESTABLISHED 0x17
#define W5500_SOCK_CLOSE_WAIT  0x1C
#define W5500_SOCK_UDP         0x22

typedef struct {
    uint8_t cs;          // chip-select GPIO pin
    uint16_t srcPort;    // auto-incrementing local source port for clients
} W5500_t;

// Reset the chip, verify it (VERSIONR == 0x04), and program MAC/IP/subnet/
// gateway. Call SPI.begin() first. Returns 1 on success, 0 if no W5500 found.
uint8_t W5500_begin(W5500_t *dev, uint8_t cs,
                    const uint8_t mac[6], const uint8_t ip[4],
                    const uint8_t subnet[4], const uint8_t gateway[4]);

// Bring-up probe: configure CS and read the chip ID register (VERSIONR).
// A healthy W5500 always returns 0x04. 0x00 or 0xFF means the SPI read got
// no valid data (wiring/power/MISO/reset problem). Call SPI.begin() first.
uint8_t W5500_version(W5500_t *dev, uint8_t cs);

// 1 if the Ethernet PHY link is up (cable connected), else 0.
uint8_t W5500_linkUp(W5500_t *dev);

// Raw socket status (one of W5500_SOCK_*).
uint8_t W5500_status(W5500_t *dev, uint8_t sock);

// ── TCP ──────────────────────────────────────────────────────────────────
// Open `sock` as a TCP client and connect to ip:port. Blocks (bounded) until
// established or failure. Returns 1 if connected.
uint8_t W5500_connect(W5500_t *dev, uint8_t sock, const uint8_t ip[4], uint16_t port);

// Open `sock` as a TCP server listening on `port`. Returns 1 on success;
// poll W5500_connected() for an incoming client.
uint8_t W5500_listen(W5500_t *dev, uint8_t sock, uint16_t port);

// 1 if the TCP socket is currently connected (ESTABLISHED).
uint8_t W5500_connected(W5500_t *dev, uint8_t sock);

// Bytes available to read on the socket's RX buffer.
uint16_t W5500_available(W5500_t *dev, uint8_t sock);

// Send `len` bytes (TCP). Returns bytes queued (0 on error/closed).
uint16_t W5500_send(W5500_t *dev, uint8_t sock, const uint8_t *buf, uint16_t len);

// Receive up to `len` bytes (TCP). Returns bytes read (0 if none).
uint16_t W5500_recv(W5500_t *dev, uint8_t sock, uint8_t *buf, uint16_t len);

// Disconnect (TCP FIN) and close the socket.
void W5500_close(W5500_t *dev, uint8_t sock);

// ── UDP ────────────────────────────────────────────────────────────────────
// Open `sock` in UDP mode bound to local `port`. Returns 1 on success.
uint8_t W5500_udpBegin(W5500_t *dev, uint8_t sock, uint16_t port);

// Send a UDP datagram of `len` bytes to ip:port. Returns bytes sent.
uint16_t W5500_udpSend(W5500_t *dev, uint8_t sock, const uint8_t ip[4],
                       uint16_t port, const uint8_t *buf, uint16_t len);

// Receive one UDP datagram into `buf` (up to `len`). On success fills
// srcip[4]/*srcport with the sender (pass NULL to ignore) and returns the
// payload length; returns 0 if nothing waiting.
uint16_t W5500_udpRecv(W5500_t *dev, uint8_t sock, uint8_t *srcip,
                       uint16_t *srcport, uint8_t *buf, uint16_t len);

#endif // PICPIO_W5500_H
