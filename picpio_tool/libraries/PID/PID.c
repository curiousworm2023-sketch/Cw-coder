// PID.c — PICPIO C port of the Arduino PID Library (Brett Beauregard, GPLv3)
#include "PID.h"

static void PID_initialize(PID_t *pid)
{
    pid->ITerm     = *(pid->myOutput);
    pid->lastInput = *(pid->myInput);
    if (pid->ITerm > pid->outMax) pid->ITerm = pid->outMax;
    else if (pid->ITerm < pid->outMin) pid->ITerm = pid->outMin;
}

void PID_init(PID_t *pid, double *input, double *output, double *setpoint,
               double Kp, double Ki, double Kd, int controllerDirection)
{
    pid->myInput    = input;
    pid->myOutput   = output;
    pid->mySetpoint = setpoint;
    pid->inAuto     = false;

    PID_setOutputLimits(pid, 0, 255);

    pid->SampleTime = 10;

    PID_setControllerDirection(pid, controllerDirection);
    PID_setTunings(pid, Kp, Ki, Kd);

    pid->lastTime = millis() - pid->SampleTime;
}

bool PID_compute(PID_t *pid)
{
    if (!pid->inAuto) return false;

    uint32_t now = millis();
    uint32_t timeChange = (now - pid->lastTime);
    if (timeChange >= pid->SampleTime) {
        double input = *(pid->myInput);
        double error = *(pid->mySetpoint) - input;
        pid->ITerm += (pid->ki * error);
        if (pid->ITerm > pid->outMax) pid->ITerm = pid->outMax;
        else if (pid->ITerm < pid->outMin) pid->ITerm = pid->outMin;
        double dInput = (input - pid->lastInput);

        double output = pid->kp * error + pid->ITerm - pid->kd * dInput;
        if (output > pid->outMax) output = pid->outMax;
        else if (output < pid->outMin) output = pid->outMin;
        *(pid->myOutput) = output;

        pid->lastInput = input;
        pid->lastTime  = now;
        return true;
    }
    return false;
}

void PID_setTunings(PID_t *pid, double Kp, double Ki, double Kd)
{
    if (Kp < 0 || Ki < 0 || Kd < 0) return;

    pid->dispKp = Kp;
    pid->dispKi = Ki;
    pid->dispKd = Kd;

    double sampleTimeInSec = ((double)pid->SampleTime) / 1000.0;
    pid->kp = Kp;
    pid->ki = Ki * sampleTimeInSec;
    pid->kd = Kd / sampleTimeInSec;

    if (pid->controllerDirection == PID_REVERSE) {
        pid->kp = -pid->kp;
        pid->ki = -pid->ki;
        pid->kd = -pid->kd;
    }
}

void PID_setSampleTime(PID_t *pid, int newSampleTime)
{
    if (newSampleTime > 0) {
        double ratio = (double)newSampleTime / (double)pid->SampleTime;
        pid->ki *= ratio;
        pid->kd /= ratio;
        pid->SampleTime = (uint32_t)newSampleTime;
    }
}

void PID_setOutputLimits(PID_t *pid, double min, double max)
{
    if (min >= max) return;
    pid->outMin = min;
    pid->outMax = max;

    if (pid->inAuto) {
        if (*(pid->myOutput) > pid->outMax) *(pid->myOutput) = pid->outMax;
        else if (*(pid->myOutput) < pid->outMin) *(pid->myOutput) = pid->outMin;

        if (pid->ITerm > pid->outMax) pid->ITerm = pid->outMax;
        else if (pid->ITerm < pid->outMin) pid->ITerm = pid->outMin;
    }
}

void PID_setMode(PID_t *pid, int mode)
{
    bool newAuto = (mode == PID_AUTOMATIC);
    if (newAuto && !pid->inAuto) {
        PID_initialize(pid);
    }
    pid->inAuto = newAuto;
}

void PID_setControllerDirection(PID_t *pid, int direction)
{
    if (pid->inAuto && direction != pid->controllerDirection) {
        pid->kp = -pid->kp;
        pid->ki = -pid->ki;
        pid->kd = -pid->kd;
    }
    pid->controllerDirection = direction;
}

double PID_getKp(PID_t *pid) { return pid->dispKp; }
double PID_getKi(PID_t *pid) { return pid->dispKi; }
double PID_getKd(PID_t *pid) { return pid->dispKd; }
int    PID_getMode(PID_t *pid) { return pid->inAuto ? PID_AUTOMATIC : PID_MANUAL; }
int    PID_getDirection(PID_t *pid) { return pid->controllerDirection; }
