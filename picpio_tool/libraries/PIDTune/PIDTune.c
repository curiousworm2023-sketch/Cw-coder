// PIDTune.c — serial auto-tuning companion for the PICPIO PID library.
#include "PIDTune.h"
#include <string.h>

// Minimal, dependency-light float parser (avoids pulling in atof/sscanf on
// XC8/XC16). Handles optional sign, integer and fractional parts.
static double pt_atof(const char *s)
{
    while (*s == ' ') s++;
    int neg = 0;
    if (*s == '-') { neg = 1; s++; }
    else if (*s == '+') { s++; }

    double r = 0.0;
    while (*s >= '0' && *s <= '9') { r = r * 10.0 + (double)(*s - '0'); s++; }
    if (*s == '.') {
        s++;
        double f = 0.1;
        while (*s >= '0' && *s <= '9') { r += (double)(*s - '0') * f; f *= 0.1; s++; }
    }
    return neg ? -r : r;
}

static void pt_emitGains(PIDTune_t *t)
{
    Serial.print_s("PIDT_GAINS:");
    Serial.print_f((float)PID_getKp(t->pid), 4); Serial.write(',');
    Serial.print_f((float)PID_getKi(t->pid), 4); Serial.write(',');
    Serial.print_f((float)PID_getKd(t->pid), 4); Serial.write('\n');
}

static void pt_handleLine(PIDTune_t *t, char *line)
{
    if (strncmp(line, "SET ", 4) == 0) {
        char *key = line + 4;
        char *eq  = key;
        while (*eq && *eq != '=') eq++;
        if (*eq != '=') return;
        *eq = '\0';
        double v = pt_atof(eq + 1);

        if      (!strcmp(key, "KP"))   PID_setTunings(t->pid, v, PID_getKi(t->pid), PID_getKd(t->pid));
        else if (!strcmp(key, "KI"))   PID_setTunings(t->pid, PID_getKp(t->pid), v, PID_getKd(t->pid));
        else if (!strcmp(key, "KD"))   PID_setTunings(t->pid, PID_getKp(t->pid), PID_getKi(t->pid), v);
        else if (!strcmp(key, "SP"))   *t->setpoint = v;
        else if (!strcmp(key, "RH"))   t->relayHigh = v;
        else if (!strcmp(key, "RL"))   t->relayLow  = v;
        else if (!strcmp(key, "HYST")) t->relayHyst = v;
        else if (!strcmp(key, "DT"))   { if (v >= 1.0) t->sampleMs = (uint16_t)v; }
        return;
    }

    if (strncmp(line, "MODE ", 5) == 0) {
        char *m = line + 5;
        if (!strcmp(m, "AUTO"))        { t->mode = PIDTUNE_AUTO;   PID_setMode(t->pid, PID_AUTOMATIC); }
        else if (!strcmp(m, "MANUAL")) { t->mode = PIDTUNE_MANUAL; PID_setMode(t->pid, PID_MANUAL); }
        else if (!strcmp(m, "RELAY"))  { t->mode = PIDTUNE_RELAY;  PID_setMode(t->pid, PID_MANUAL); }
        Serial.print_s("PIDT_MODE:");
        Serial.println_s(m);
        return;
    }

    if (!strcmp(line, "GET")) {
        pt_emitGains(t);
        return;
    }
}

void PIDTune_init(PIDTune_t *t, PID_t *pid,
                  double *input, double *output, double *setpoint)
{
    t->pid       = pid;
    t->input     = input;
    t->output    = output;
    t->setpoint  = setpoint;
    t->relayHigh = pid->outMax;
    t->relayLow  = pid->outMin;
    t->relayHyst = 0.0;
    t->mode      = PIDTUNE_AUTO;
    t->sampleMs  = 50;
    t->lastService = millis();
    t->rxlen     = 0;
}

void PIDTune_setSampleMs(PIDTune_t *t, uint16_t ms)
{
    if (ms >= 1) t->sampleMs = ms;
}

void PIDTune_service(PIDTune_t *t)
{
    // Drain any pending serial bytes and dispatch completed lines.
    while (Serial.available() > 0) {
        int ch = Serial.read();
        if (ch < 0) break;
        if (ch == '\n' || ch == '\r') {
            if (t->rxlen) {
                t->rxbuf[t->rxlen] = '\0';
                pt_handleLine(t, t->rxbuf);
                t->rxlen = 0;
            }
        } else if (t->rxlen < (uint8_t)(sizeof(t->rxbuf) - 1)) {
            t->rxbuf[t->rxlen++] = (char)ch;
        } else {
            t->rxlen = 0; // overrun — drop the malformed line
        }
    }

    uint32_t now = millis();
    if ((uint32_t)(now - t->lastService) < t->sampleMs) return;
    t->lastService = now;

    double pv = *t->input;
    double sp = *t->setpoint;

    // Relay (bang-bang) excitation: drive the output hard one way until the
    // process value crosses the setpoint (plus hysteresis), then the other.
    if (t->mode == PIDTUNE_RELAY) {
        if (pv < sp - t->relayHyst)      *t->output = t->relayHigh;
        else if (pv > sp + t->relayHyst) *t->output = t->relayLow;
    }

    Serial.print_s("PIDT:");
    Serial.print_f((float)pv, 3);            Serial.write(',');
    Serial.print_f((float)sp, 3);            Serial.write(',');
    Serial.print_f((float)(*t->output), 3);  Serial.write('\n');
}
