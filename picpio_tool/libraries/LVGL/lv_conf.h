/**
 * lv_conf.h — LVGL v8.x configuration for PICPIO
 * Copy this file to your project's src/ or include/ directory as lv_conf.h
 * 
 * Note: LVGL requires significant RAM (minimum 8KB recommended).
 * Most PIC16/PIC18 have only 2KB-4KB RAM. Use PIC24/dsPIC or PIC32 for LVGL.
 */

#ifndef LV_CONF_H
#define LV_CONF_H

#include <stdint.h>

/*====================
   MEMORY SETTINGS
  ====================*/
#define LV_MEM_SIZE        (8U * 1024U)
#define LV_LOG_LEVEL       LV_LOG_LEVEL_NONE

/*====================
   HAL SETTINGS
  ====================*/
#define LV_TICK_CUSTOM 1
#define LV_TICK_CUSTOM_INCLUDE "Picpio.h"
#define LV_TICK_CUSTOM_SYS_TIME_EXPR (sys_millis())

/*====================
   DISPLAY SETTINGS
  ====================*/
#define LV_HOR_RES          240
#define LV_VER_RES          320
#define LV_COLOR_DEPTH      16

/*====================
   FEATURE SETTINGS
  ====================*/
#define LV_USE_LOG          0
#define LV_USE_ASSERT_NULL  0
#define LV_USE_ASSERT_MEM   0
#define LV_USE_ASSERT_STR 0
#define LV_USE_ASSERT_OBJ 0

/* Widgets - minimal set */
#define LV_USE_LABEL        1
#define LV_USE_BUTTON       1
#define LV_USE_BAR          1
#define LV_USE_SLIDER       1
#define LV_USE_IMG          1
#define LV_USE_LINE         1
#define LV_USE_CHECKBOX     0
#define LV_USE_SWITCH       0
#define LV_USE_TEXTAREA     0
#define LV_USE_CANVAS       0

/*====================
   FONT SETTINGS
  ====================*/
#define LV_FONT_DEFAULT    &lv_font_montserrat_14
#define LV_FONT_FMT_TXT    1

#endif /* LV_CONF_H */