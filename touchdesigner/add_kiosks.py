def setup_concert_kiosks():
    # Use the parent of this script so nodes spawn right here in /project1
    root_comp = me.parent()
    
    # Check if the base already exists and remove it to allow clean re-runs
    base_name = 'ConcertAppKiosks'
    existing = root_comp.findChildren(name=base_name, depth=1)
    if existing:
        existing[0].destroy()
        
    kiosks_base = root_comp.create(baseCOMP, base_name)
    kiosks_base.nodeX = 0
    kiosks_base.nodeY = 0
    
    # --- 1. Custom Settings Parameters ---
    settings_page = kiosks_base.appendCustomPage('Settings')
    
    use_prod = settings_page.appendToggle('Useprod', label='Use Production')[0]
    is_active = settings_page.appendToggle('Active', label='Active')[0]
    local_host = settings_page.appendStr('Localhost', label='Local Host')[0]
    prod_host = settings_page.appendStr('Prodhost', label='Prod Host')[0]
    
    is_active.val = True
    local_host.val = 'http://localhost:8000'
    prod_host.val = 'https://concert-app-r52d.onrender.com'
    
    settings_page.appendPulse('Reload', label='Reload Source')
    
    # --- 2. Custom API Parameters ---
    api_page = kiosks_base.appendCustomPage('API')
    track_id = api_page.appendStr('Trackid', label='Track ID')[0]
    track_title = api_page.appendStr('Tracktitle', label='Track Title')[0]
    
    track_id.val = '1'
    track_title.val = 'The Upbeat Opener'
    
    api_page.appendPulse('Starttrack', label='Start Track')
    api_page.appendPulse('Endtrack', label='End Track')
    
    # --- 3. Build Web Render & Spout Nodes ---
    web1 = kiosks_base.create(webrenderTOP, 'webrender_kiosk1')
    web1.par.resolutionw = 1280
    web1.par.resolutionh = 720
    web1.nodeX = -200
    web1.nodeY = 200
    web1.par.url.expr = "(parent().par.Prodhost.eval() if parent().par.Useprod.eval() else parent().par.Localhost.eval()) + '/kiosk1.html'"
    web1.par.active.expr = "parent().par.Active.eval()"

    spout1 = kiosks_base.create(spoutoutTOP, 'spout_kiosk1')
    spout1.par.sendername = 'ConcertApp_Kiosk1'
    spout1.nodeX = 0
    spout1.nodeY = 200
    spout1.inputConnectors[0].connect(web1)

    web2 = kiosks_base.create(webrenderTOP, 'webrender_kiosk2')
    web2.par.resolutionw = 1280
    web2.par.resolutionh = 720
    web2.nodeX = -200
    web2.nodeY = 0
    web2.par.url.expr = "(parent().par.Prodhost.eval() if parent().par.Useprod.eval() else parent().par.Localhost.eval()) + '/kiosk2.html'"
    web2.par.active.expr = "parent().par.Active.eval()"

    spout2 = kiosks_base.create(spoutoutTOP, 'spout_kiosk2')
    spout2.par.sendername = 'ConcertApp_Kiosk2'
    spout2.nodeX = 0
    spout2.nodeY = 0
    spout2.inputConnectors[0].connect(web2)
    
    # --- 4. Build API Execution DAT ---
    parexec = kiosks_base.create(parameterexecuteDAT, 'api_requests')
    parexec.nodeX = -200
    parexec.nodeY = -200
    parexec.par.pars = 'Starttrack Endtrack Reload'
    
    script = """import threading
import urllib.request
import json

def send_request(url, data=None):
    try:
        if data:
            req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
        else:
            req = urllib.request.Request(url, method='POST')
        with urllib.request.urlopen(req, timeout=5) as response:
            print("API Response:", response.getcode())
    except Exception as e:
        print("API Request failed:", str(e))

def onPulse(par):
    base = par.owner
    host = base.par.Prodhost.eval() if base.par.Useprod.eval() else base.par.Localhost.eval()
    
    if par.name == 'Starttrack':
        url = f"{host}/api/track"
        data = {
            'id': base.par.Trackid.eval(),
            'title': base.par.Tracktitle.eval()
        }
        threading.Thread(target=send_request, args=(url, data), daemon=True).start()
    elif par.name == 'Endtrack':
        url = f"{host}/api/track/end"
        threading.Thread(target=send_request, args=(url,), daemon=True).start()
    elif par.name == 'Reload':
        op('webrender_kiosk1').par.reload.pulse()
        op('webrender_kiosk2').par.reload.pulse()
"""
    parexec.text = script.strip()
    
    print("Successfully created ConcertAppKiosks baseCOMP with interactive URL toggles and API bindings.")

setup_concert_kiosks()
