#pragma once
#include <stdint.h>

// EXAMPLE ONLY — copy to secrets.h LOCALLY and fill in values.
// Do not commit the resulting secrets.h file.
// ESP32-S3 needs 2.4 GHz Wi-Fi.
static const char WIFI_SSID[] = "YOUR_WIFI_SSID";
static const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";

// Host only, not a URL; obtain it from the HiveMQ Cluster Overview page.
static const char MQTT_HOST[] =
    "730b8f62b55c4753803b4302a8cf6bf4.s1.eu.hivemq.cloud";
static constexpr uint16_t MQTT_PORT = 8883;
static const char MQTT_USERNAME[] = "YOUR_DEVICE_MQTT_USERNAME";
static const char MQTT_PASSWORD[] = "YOUR_DEVICE_MQTT_PASSWORD";
