// lv_port_indev.c — LVGL input port for PICPIO XPT2046 driver
// Add this to your PICPIO project to enable LVGL touch input.

#include "lv_conf.h"
#include "lvgl.h"
#include "XPT2046.h"

static lv_indev_drv_t indev_drv;

void lv_port_indev_init(XPT2046_t *touch) {
    lv_indev_drv_init(&indev_drv);
    indev_drv.type = LV_INDEV_TYPE_POINTER;
    indev_drv.read_cb = lv_port_indev_read;
    indev_drv.user_data = touch;
    lv_indev_drv_register(&indev_drv);
}

static void lv_port_indev_read(lv_indev_drv_t *indev, lv_indev_data_t *data) {
    XPT2046_t *touch = (XPT2046_t*)indev->user_data;
    
    if (XPT2046_touched(touch)) {
        uint16_t tx, ty;
        XPT2046_read(touch, &tx, &ty);
        data->point.x = tx;
        data->point.y = ty;
        data->state = LV_INDEV_STATE_PRESSED;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}