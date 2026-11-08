# Sidee integration

SmartTube is **not in Sidee's built-in catalog** as of Sidee master. Sidee only
needs a preset entry to install the hosted or self-hosted app as a launcher
tile. The dashboard card is optional; the CLI works with just the preset.

## Add the preset (one-time)

Use a Sidee source checkout so `core/presets.py` can be edited:

```bash
git clone https://github.com/Empi9245/Sidee
cd Sidee
python3 -m pip install -r requirements.txt
```

Open `core/presets.py`, find the `PRESETS` dictionary, and add the
`"smarttube"` entry from [`smarttube_preset.py`](smarttube_preset.py).

Start Sidee and pair the TV:

```bash
python3 sidee.py
# dashboard: Find TV -> Request code -> enter the 4-digit PIN -> Confirm
```

Install the tile from the CLI:

```bash
python3 sidee.py install smarttube
```

Press Home on the TV and open the SmartTube tile.

## Self-hosted build

The preset points at the hosted build by default. To use your own build,
edit the `url` and `image` fields in the preset before installing:

```python
"url": "https://your-host.example.com/index.html",
"image": "https://your-host.example.com/icon.png",
```

Some Sidee checkouts also support:

```bash
python3 sidee.py install smarttube --url https://your-host.example.com/
```

## Dashboard card (optional)

The CLI install above is enough. If you want the SmartTube card in the Sidee
dashboard, add the card markup and JavaScript to `core/dashboard.html` and copy
[`smarttube.png`](smarttube.png) to Sidee's `assets/` directory.

## Why this is needed

Sidee's packaged releases do not ship the SmartTube preset, and packaged builds
may not allow editing `core/presets.py`. Use a source checkout, or a Sidee build
that already includes the preset.
