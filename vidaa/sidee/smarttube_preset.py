# Sidee preset for SmartTube for VIDAA.
#
# Paste this entry inside the PRESETS dictionary in Sidee's core/presets.py.
# Keep the trailing comma. app_id must be unique and is what the TV caches,
# so bump both the URL path and app_id together for a new release.
"smarttube": {
    "name": "SmartTube",
    "app_id": "smarttube16",
    # No default host: each user must supply their own hosted build.
    "needs_url": True,
    "supports_custom_url": True,
    "url": "",
    "url_placeholder": "https://… or http://192.168.…:8090/",
    "image": "https://raw.githubusercontent.com/antmagl/smarttube-vidaa/main/vidaa/icon.png",
    "description": "Ad-free YouTube for VIDAA with SponsorBlock",
},
