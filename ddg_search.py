import urllib.request
import urllib.parse
import json
import re

def search_ddg(query):
    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req).read().decode("utf-8")
    matches = re.findall(r'<img.*?src="(.*?)".*?>', html)
    for m in matches:
        if m.startswith("//"):
            print("https:" + m)
            return

search_ddg("guitar icon")
