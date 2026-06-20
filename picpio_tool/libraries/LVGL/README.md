// LVGL library support for PICPIO
// 
// Requirements:
// - LVGL source code must be placed in lib/LVGL/ directory
// - Copy lv_conf.h to your project's src/ or include/ folder
// - Add lv_port_disp.c and lv_port_indev.c to your project
//
// Memory constraints:
// - LVGL needs minimum 8KB RAM (PIC24/dsPIC/PIC32 recommended)
// - Most PIC16/PIC18 chips have only 2-4KB RAM (not recommended)
//
// Usage in your sketch:
//   #include "ILI9341.h"
//   #include "XPT2046.h"
//   #include "lvgl.h"
//   
//   ILI9341_t tft;
//   XPT2046_t touch;
//   
//   void init() {
//       SPI.begin();
//       ILI9341_init(&tft, D10, D9, D8);
//       ILI9341_begin(&tft, 240, 320);
//       XPT2046_init(&touch, D7, D6);
//       
//       lv_port_disp_init(&tft);
//       lv_port_indev_init(&touch);
//   }
//   
//   void run() {
//       lv_timer_handler();
//       sys_delay(5);
//   }