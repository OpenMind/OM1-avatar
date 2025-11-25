# OM1 Avatar

A modern React-based frontend application that provides the user interface and avatar display system for OM1 robotics software. This application features interactive Rive animations and serves as the primary visual interface for OM1 robotic systems.

## Overview

OM1 Avatar is built with React, TypeScript, and Vite, delivering a responsive and engaging user interface for robotics applications. The application showcases animated avatars and provides a seamless frontend experience for OM1 robotics software interaction.


## Production

To run the application in production mode, use Docker Compose:

```bash
docker-compose up -d
```

Install `unclutter` on your system to hide the mouse cursor after a period of inactivity:

```bash
sudo apt install unclutter
```

Install Chromium and lock the `snapd` version for stability:

```bash
sudo snap install chromium
```
```bash
snap download snapd --revision=24724
sudo snap ack snapd_24724.assert
sudo snap install snapd_24724.snap
sudo snap refresh --hold snapd
```

Add the script to `/usr/local/bin/start-kiosk.sh` and make it executable:

```bash
#!/bin/bash

unclutter -display :0 -idle 0.1 -root &

HOST=localhost
PORT=4173

# Wait for Docker service to listen
while ! nc -z $HOST $PORT; do
  echo "Waiting for $HOST:$PORT..."
  sleep 0.1
done

# Launch with autoplay permissions
exec chromium \
  --kiosk http://$HOST:$PORT \
  --disable-infobars \
  --noerrdialogs \
  --autoplay-policy=no-user-gesture-required \
  --disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies
```

Make the script executable:

```bash
chmod +x /usr/local/bin/start-kiosk.sh
```

Add the script to `/etc/systemd/system/kiosk.service` to launch the kiosk mode automatically on boot.

```bash
# /etc/systemd/system/kiosk.service
[Unit]
Description=Kiosk Browser
After=docker.service
Requires=docker.service

[Service]
Environment=DISPLAY=:0
ExecStart=/usr/local/bin/start-kiosk.sh
Restart=always
User=openmind

[Install]
WantedBy=graphical.target
```

Enable and start the kiosk service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable kiosk.service
sudo systemctl start kiosk.service
```

> Note: To stop the kiosk service, use `sudo systemctl stop kiosk.service`.

To set the default the speaker and mircophone:

```bash
vim /usr/local/bin/set-audio-defaults.sh
```

The add:

```
#!/bin/bash
set -e

sleep 5

# First, set the master source volume to 100%
pactl set-source-volume "alsa_input.usb-R__DE_R__DE_VideoMic_GO_II_FEB0C614-00.mono-fallback" 65536
pactl set-source-mute "alsa_input.usb-R__DE_R__DE_VideoMic_GO_II_FEB0C614-00.mono-fallback" 0

# Unload then load AEC module
pactl unload-module module-echo-cancel || true
pactl load-module module-echo-cancel \
  use_master_format=1 \
  aec_method=webrtc \
  source_master="alsa_input.usb-R__DE_R__DE_VideoMic_GO_II_FEB0C614-00.mono-fallback" \
  sink_master="alsa_output.platform-88090b0000.hda.hdmi-stereo" \
  source_name="default_mic_aec" \
  sink_name="default_output_aec" \
  source_properties="device.description=Microphone_with_AEC" \
  sink_properties="device.description=Speaker_with_AEC"

# Wait a moment for the module to fully initialize
sleep 2

# Set defaults
pactl set-default-source default_mic_aec
pactl set-default-sink default_output_aec

# Retry volume setting until device appears and volume is set correctly
for i in {1..15}; do
  if pactl list short sources | grep -q default_mic_aec; then
    # Set volume to 100% (65536)
    pactl set-source-volume default_mic_aec 65536
    pactl set-source-mute default_mic_aec 0

    # Verify the volume was set
    CURRENT_VOL=$(pactl list sources | grep -A 7 "Name: default_mic_aec" | grep "Volume:" | awk '{print $3}')

    if [ "$CURRENT_VOL" = "65536" ]; then
      echo "Microphone volume successfully set to 100%"
      break
    else
      echo "Volume is $CURRENT_VOL, retrying... ($i/15)"
    fi
  else
    echo "Waiting for AEC source to appear... ($i/15)"
  fi
  sleep 1
done

# Final verification
pactl list sources | grep -A 7 "Name: default_mic_aec" | grep -E "Name:|Volume:"
```

Use
```bash
pactl list short
```

and replace ```alsa_output.platform-88090b0000.hda.hdmi-stereo``` with your speaker source and ```alsa_input.usb-R__DE_R__DE_VideoMic_GO_II_FEB0C614-00.mono-fallback``` with mic source

Then make it executable:

```bash
chmod +x /usr/local/bin/set-audio-defaults.sh
```

Create a systemd user service to run the script on login:

```bash
mkdir -p ~/.config/systemd/user
vim ~/.config/systemd/user/audio-defaults.service
```

And add

```bash
[Unit]
Description=Set Default Audio Devices
After=pulseaudio.service
Wants=pulseaudio.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/set-audio-defaults.sh

[Install]
WantedBy=default.target
```

Enable and start the audio defaults service:

```bash
systemctl --user daemon-reload
systemctl --user enable audio-defaults.service
systemctl --user start audio-defaults.service
```

Due to the audio configuration, you need to restart the OM1 container to apply the changes when the system is started:

```bash
docker-compose restart om1
```

You can add this service to `/etc/systemd/system/om1-container.service` to automatically restart the OM1 container on boot:

```bash
[Unit]
Description=Restart OM1
After=docker.service multi-user.target
Wants=docker.service

[Service]
Type=simple
ExecStart=/bin/bash -c 'sleep 15 && docker restart om1'
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
```

Enable and start the om1-container service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable om1-container.service
sudo systemctl start om1-container.service
```

## License

This project is licensed under the terms specified in the LICENSE file.

-----

**Note**: This frontend application is designed to work in conjunction with OM1 robotics backend systems and hardware components.
