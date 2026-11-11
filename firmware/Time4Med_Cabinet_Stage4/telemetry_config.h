#pragma once
/*
 * Time4Med cabinet STAGING telemetry configuration.
 * For convenience, the firmware compiles with HTTPS telemetry disabled
 * until a PRIVATE, untracked telemetry_private.h exists in this folder.
 *
 * NEVER push telemetry_private.h to GitHub or include secret values in screenshots.
 */
#if __has_include("telemetry_private.h")
#include "telemetry_private.h"
#endif
#ifndef TIME4MED_STATUS_ENDPOINT
#define TIME4MED_STATUS_ENDPOINT ""
#endif
#ifndef TIME4MED_STATUS_HMAC_KEY
#define TIME4MED_STATUS_HMAC_KEY ""
#endif
#ifndef TIME4MED_STATUS_ROOT_CA_PEM
#define TIME4MED_STATUS_ROOT_CA_PEM ""
#endif
