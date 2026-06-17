// PIDTune.h — PICPIO serial auto-tuning companion for the PID library.
//
// Adds a tiny line-based serial protocol so the PICPIO "Auto PID Tuning"
// panel (VS Code) can drive the running firmware: stream the live process
// value, change Kp/Ki/Kd and the setpoint at runtime, and toggle a relay
// (bang-bang) mode used to provoke a controlled oscillation for the
// Ziegler-Nichols ultimate-gain measurement.
//
// Requires the PID library. Typical wiring in loop():
//     PID_compute(&pid);          // normal control (no-op while in RELAY mode)
//     PIDTune_service(&pidtune);  // parse host commands + stream telemetry
//     analogWrite(pin, (uint8_t)pidOutput);
//
// Serial protocol
//   firmware -> host (every sample):   PIDT:<pv>,<sp>,<out>\n
//   firmware -> host (on GET / mode):  PIDT_GAINS:<kp>,<ki>,<kd>\n
//                                      PIDT_MODE:<AUTO|MANUAL|RELAY>\n
//   host -> firmware (one per line):
//       SET KP=<f> | SET KI=<f> | SET KD=<f>   change tunings
//       SET SP=<f>                             change setpoint
//       SET RH=<f> | SET RL=<f>                relay high / low output level
//       SET HYST=<f>                           relay hysteresis band
//       SET DT=<n>                             telemetry/relay period (ms)
//       MODE AUTO | MODE MANUAL | MODE RELAY   switch controller mode
//       GET                                    echo current gains
#ifndef PIDTUNE_H
#define PIDTUNE_H

#include "Picpio.h"
#include "PID.h"

#define PIDTUNE_MANUAL 0
#define PIDTUNE_AUTO   1
#define PIDTUNE_RELAY  2

typedef struct {
    PID_t   *pid;
    double  *input;
    double  *output;
    double  *setpoint;

    double   relayHigh;   // output level driven when PV is below setpoint
    double   relayLow;    // output level driven when PV is above setpoint
    double   relayHyst;   // dead-band around setpoint (0 = none)

    uint8_t  mode;        // PIDTUNE_AUTO / _MANUAL / _RELAY
    uint16_t sampleMs;    // telemetry + relay update period
    uint32_t lastService;

    char     rxbuf[40];
    uint8_t  rxlen;
} PIDTune_t;

// Links the tuner to the PID and its Input/Output/Setpoint variables.
// Defaults: AUTO mode, 50 ms telemetry, relay swings the PID's full output
// range (outMin..outMax), no hysteresis.
void PIDTune_init(PIDTune_t *t, PID_t *pid,
                  double *input, double *output, double *setpoint);

// Telemetry / relay update period in milliseconds.
void PIDTune_setSampleMs(PIDTune_t *t, uint16_t ms);

// Call once per loop(): drains serial commands, and at each sample interval
// drives the relay output (RELAY mode only) and streams a PIDT: telemetry
// line. Does NOT call PID_compute — keep your own PID_compute() in loop();
// it harmlessly no-ops while the tuner holds the PID in MANUAL/RELAY.
void PIDTune_service(PIDTune_t *t);

#endif // PIDTUNE_H
