// PID.h — PICPIO C port of the Arduino PID Library (Brett Beauregard, GPLv3)
// Usage: PID_t pid; PID_init(&pid, &input, &output, &setpoint, Kp, Ki, Kd, PID_DIRECT);
//        PID_setMode(&pid, PID_AUTOMATIC);
//        in loop(): PID_compute(&pid);
#ifndef PID_H
#define PID_H

#include "Picpio.h"

#define PID_AUTOMATIC 1
#define PID_MANUAL    0
#define PID_DIRECT    0
#define PID_REVERSE   1

typedef struct {
    double  *myInput;
    double  *myOutput;
    double  *mySetpoint;

    double  dispKp, dispKi, dispKd;
    double  kp, ki, kd;

    int     controllerDirection;

    uint32_t lastTime;
    double   ITerm, lastInput;

    uint32_t SampleTime;
    double   outMin, outMax;
    bool     inAuto;
} PID_t;

// Links the PID to Input, Output and Setpoint and sets initial tunings.
void PID_init(PID_t *pid, double *input, double *output, double *setpoint,
               double Kp, double Ki, double Kd, int controllerDirection);

// Performs the PID calculation. Call every loop() iteration.
// Returns true when a new output was computed (respects SampleTime).
bool PID_compute(PID_t *pid);

// Clamps the output (and internal integral term) to [min, max].
void PID_setOutputLimits(PID_t *pid, double min, double max);

// Changes Kp/Ki/Kd at runtime.
void PID_setTunings(PID_t *pid, double Kp, double Ki, double Kd);

// Sets the controller direction: PID_DIRECT or PID_REVERSE.
void PID_setControllerDirection(PID_t *pid, int direction);

// Sets how often Compute() recalculates, in milliseconds (default 100ms... actually 10ms here).
void PID_setSampleTime(PID_t *pid, int newSampleTime);

// PID_MANUAL (0) or PID_AUTOMATIC (non-zero). Switching to automatic re-initializes for a bumpless transfer.
void PID_setMode(PID_t *pid, int mode);

double PID_getKp(PID_t *pid);
double PID_getKi(PID_t *pid);
double PID_getKd(PID_t *pid);
int    PID_getMode(PID_t *pid);
int    PID_getDirection(PID_t *pid);

#endif // PID_H
