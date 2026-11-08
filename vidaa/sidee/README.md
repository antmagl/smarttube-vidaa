# Sidee integration

SmartTube is **not in upstream Sidee master**. The easiest path is
[antmagl/Sidee](https://github.com/antmagl/Sidee), a fork that includes Linux
support and this preset; its dashboard has a built-in SmartTube card.

If you use upstream Sidee, add the preset below to a source checkout. Sidee
only needs a preset entry to install the hosted or self-hosted app as a
launcher tile; the dashboard card is optional and the CLI works with just the
preset.

## Use the fork (recommended)

```bash
git clone https://github.com/antmagl/Sidee
cd Sidee
python3 -m pip install -r requirements.txt
python3 sidee.py
```

On Windows use `python` instead of `python3`. The fork is installed from source;
it does not publish release packages.

Pair the TV, then choose **SmartTube** in the dashboard (or run
`python3 sidee.py install smarttube`).

## Add the preset to upstream Sidee (one-time)

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

A self-hosted build needs a proxy for 1080p and sign-in. Without one the TV
shows only 360p/240p and cannot sign in or record history.

## Dashboard card (optional)

The CLI install above is enough. If you want the SmartTube card in the Sidee
dashboard, add the card markup and JavaScript to `core/dashboard.html` and copy
[`smarttube.png`](smarttube.png) to Sidee's `assets/` directory.

## Why this is needed

Upstream Sidee does not ship the SmartTube preset. This fork includes it and is
installed from source with `python sidee.py`; no release packages are
published.
