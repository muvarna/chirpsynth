# 🦜 Bird Song Sampler Synth
An interactive web-based synthesizer that transforms real bird vocalizations into playable musical instruments.
![Synth Screenshot](screen.png)

## 🚀 [Play the Synth Live Here!](https://muvarna.github.io/chirpsynth/)

---

## 🎵 How it Works
This app utilizes Digital Signal Processing (DSP) to bridge the gap between nature and music:
1. **Source:** It pulls bird calls/songs from the [Cornell Lab of Ornithology](https://dl.allaboutbirds.org/backyardbirdsdownload-0).
2. **Analysis:** The engine isolates segments with a **stable pitch** to ensure the sample is musical.
3. **Synthesis:** These segments are mapped to a keyboard, allowing you to play "nature" like a MIDI instrument.

## 🎹 Features
* **Playable Keyboard:** Use your mouse or computer keys to play the bird notes.
* **Auto-Load:** A new random bird loads every time you refresh the app.
* **Custom Audio:** You can upload your own `.mp3` bird recordings to create custom synths.
* **Record:** Export your performances directly to `.mp3`.

## 🐦 Included Bird Species
The repository currently features a library of signals from:
* **Woodpeckers:** Downy Woodpecker (Calls & Drum), Northern Flicker (Drum)
* **Jays & Chickadees:** Steller's Jay, Black-capped Chickadee
* **Songbirds:** White-crowned Sparrow, Red-winged Blackbird, House Finch
* **Others:** White-breasted Nuthatch, Pine Siskin, Evening Grosbeak

---

## 📂 Data Sources
The audio files used in this project are sourced from:
* **Bird Signals Repo:** [muvarna/bird-signals](https://github.com/muvarna/bird-signals/tree/main)
* **Original Audio:** [Cornell Lab of Ornithology](https://dl.allaboutbirds.org/backyardbirdsdownload-0)

---
*Created with love for birders and musicians alike.*
