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
After=graphical.target docker.service
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
ExecStart=/bin/bash -c '\
  sleep 5 && \
  pactl unload-module module-echo-cancel || true && \
  pactl load-module module-echo-cancel \
    aec_method=webrtc \
    source_master=alsa_input.usb-046d_Brio_101_2520APKJ1778-02.mono-fallback \
    sink_master=alsa_output.usb-Solid_State_System_Co._Ltd._USB_PnP_Audio_Device_000000000000-00.analog-stereo \
    source_name=default_mic_aec \
    sink_name=default_output_aec \
    source_properties="device.description=Microphone_with_AEC" \
    sink_properties="device.description=Speaker_with_AEC" && \
  pactl set-default-source default_mic_aec && \
  pactl set-default-sink default_output_aec'

[Install]
WantedBy=default.target
```
Use
```bash
pactl list short
```
and replace ```alsa_output.usb-Solid_State_System_Co._Ltd._USB_PnP_Audio_Device_000000000000-00.analog-stereo``` with your speaker source and ```alsa_input.usb-046d_Brio_101_2520APKJ1778-02.mono-fallback``` with mic source

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
