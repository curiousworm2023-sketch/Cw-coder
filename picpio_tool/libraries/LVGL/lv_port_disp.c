// lv_port_disp.c — LVGL display port for PICPIO ILI9341 driver
// Add this to your PICPIO project to enable LVGL graphics.

#include "lv_conf.h"
#include "lvgl.h"
#include "ILI9341.h"

static lv_disp_drv_t disp_drv;

void lv_port_disp_init(ILI9341_t *tft) {
    static lv_disp_draw_buf_t draw_buf;
    static lv_color_t buf1[LV_HOR_RES * 10];
    
    lv_disp_draw_buf_init(&draw_buf, buf1, NULL, LV_HOR_RES * 10);
    
    lv_disp_drv_init(&disp_drv);
    disp_drv.hor_res = tft->width;
    disp_drv.ver_res = tft->height;
    disp_drv.flush_cb = lv_port_disp_flush;
    disp_drv.draw_buf = &draw_buf;
    disp_drv.user_data = tft;
    lv_disp_drv_register(&disp_drv);
}

static void lv_port_disp_flush(lv_disp_drv_t *disp, const lv_area_t *area, lv_color_t *color_p) {
    ILI9341_t *tft = (ILI9341_t*)disp->user_data;
    uint32_t w = area->x2 - area->x1 + 1;
    uint32_t h = area->y2 - area->y1 + 1;
    
    // Set address window (inline for efficiency)
    gpio_write(tft->cs, LOW);
    gpio_write(tft->dc, LOW);
    SPI.transfer(ILI9341_CASET);
    gpio_write(tft->dc, HIGH);
    SPI.transfer(area->x1 >> 8);
    SPI.transfer(area->x1 & 0xFF);
    SPI.transfer(area->x2 >> 8);
    SPI.transfer(area->x2 & 0xFF);
    
    gpio_write(tft->dc, LOW);
    SPI.transfer(ILI9341_RASET);
    gpio_write(tft->dc, HIGH);
    SPI.transfer(area->y1 >> 8);
    SPI.transfer(area->y1 & 0xFF);
    SPI.transfer(area->y2 >> 8);
    SPI.transfer(area->y2 & 0xFF);
    
    gpio_write(tft->dc, LOW);
    SPI.transfer(ILI9341_RAMWR);
    gpio_write(tft->dc, HIGH);
    
    for (uint32_t i = 0; i < w * h; i++) {
        uint16_t c = ((color_p[i].ch.red & 0xF8) << 8) | ((color_p[i].ch.green & 0xFC) << 3) | (color_p[i].ch.blue >> 3);
        SPI.transfer(c >> 8);
        SPI.transfer(c & 0xFF);
    }
    gpio_write(tft->cs, HIGH);
    
    lv_disp_flush_ready(disp);
}