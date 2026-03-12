# td_builder.py
# Run this script in TouchDesigner (e.g. inside a Text DAT then right-click -> "Run Script")
# This will procedurally build the network for receiving OSC messages and sending REST HTTP requests

def build_osc_to_rest_bridge():
    # 1. Create a container for the bridge
    root = op('/')
    project = root.op('project1')
    
    existing = project.op('osc_to_rest_bridge')
    if existing:
        existing.destroy()
    base = project.create(baseCOMP, 'osc_to_rest_bridge')
    base.nodeX = 0
    base.nodeY = 0

    # 2. Custom Settings Parameters
    settings_page = base.appendCustomPage('Settings')
    use_prod = settings_page.appendToggle('Useprod', label='Use Production')[0]
    local_host = settings_page.appendStr('Localhost', label='Local Host')[0]
    prod_host = settings_page.appendStr('Prodhost', label='Prod Host')[0]
    osc_port = settings_page.appendInt('Oscport', label='OSC Port')[0]
    osc_show_update_path = settings_page.appendStr('Oscshowupdatepath', label='Show Update OSC Path')[0]
    osc_track_update_path = settings_page.appendStr('Osctrackupdatepath', label='Track Update OSC Path')[0]
    
    settings_page.appendPulse('Clearall', label='Clear Data')
    settings_page.appendPulse('Statepre', label='Set Lobby State')
    settings_page.appendPulse('Stateactive', label='Set Active State')
    settings_page.appendPulse('Statepost', label='Set Ended State')
    
    track_title = settings_page.appendStr('Tracktitle', label='Track Title')[0]
    track_title.val = "My New Track"
    settings_page.appendPulse('Updatetrack', label='Send Track Update')
    
    local_host.val = 'http://localhost:8000'
    prod_host.val = 'https://concert-app-r52d.onrender.com'
    osc_port.val = 9001
    osc_show_update_path.val = '/show/update'
    osc_track_update_path.val = '/track/update'

    # 3. Create the OSC In DAT to receive from Resolume
    osc_in = base.create(oscinDAT, 'oscin1')
    osc_in.nodeX = 0
    osc_in.nodeY = 200
    osc_in.par.port.expr = "parent().par.Oscport.eval()"
    
    # Send a copy to an Out DAT for preview context
    osc_out = base.create(outDAT, 'out1')
    osc_out.nodeX = 0
    osc_out.nodeY = -150
    osc_out.inputConnectors[0].connect(osc_in)
    
    # Expose the OSC DAT log as the graphical thumbnail on the baseCOMP
    base.par.opviewer = osc_in.path

    # 4. Create the Web Client DAT to send to Node.js backend
    web_client = base.create(webclientDAT, 'webclient1')
    web_client.nodeX = 400
    web_client.nodeY = 0
    web_client.par.url.expr = "parent().par.Prodhost.eval() if parent().par.Useprod.eval() else parent().par.Localhost.eval()"
    
    # 5. Create or grab the Text DAT for the OSC In callbacks
    callback_dat_name = osc_in.par.callbacks.eval()
    
    osc_callbacks = base.op(callback_dat_name)
    if not osc_callbacks:
        osc_callbacks = base.create(textDAT, callback_dat_name if callback_dat_name else 'oscin1_callbacks')
        osc_in.par.callbacks = osc_callbacks.name
        
    osc_callbacks.nodeX = 0
    osc_callbacks.nodeY = 0
    
    # Break any physical wire connections to prevent cook loops!
    osc_callbacks.inputConnectors[0].disconnect()

    # 6. Write the Python logic inside the callback DAT
    callback_script = """# OSC In Callback Script
import json

def onReceiveOSC(dat, rowIndex, message, bytes, timeStamp, source, sendPort, receivePort):
    webclient = op('webclient1')
    base_url = webclient.par.url.eval()
    
    # Read the custom trigger paths from the parent container
    show_update_path = op('..').par.Oscshowupdatepath.eval()
    track_update_path = op('..').par.Osctrackupdatepath.eval()
    
    address = str(dat[rowIndex, 0].val)
    val = ""
    if dat.numCols > 1:
        val = str(dat[rowIndex, 1].val)
    else:
        # Fallback if somehow address and value are space separated in the first column
        parts = address.split(' ', 1)
        if len(parts) > 1:
            address = parts[0]
            val = parts[1]
            
    val = val.strip()
    
    if address == show_update_path:
        print(f"OSC Show Update Received: {val}")
        state_map = {'lobby': 'PRE_SHOW', 'active': 'ACTIVE', 'end': 'POST_SHOW'}
        if val.lower() in state_map:
            webclient.request(
                base_url + "/api/state",
                'POST',
                header={'Content-Type': 'application/json'},
                data=json.dumps({"newState": state_map[val.lower()]})
            )
            
    elif address == track_update_path:
        print(f"OSC Track Update Received: {val}")
        if val.lower() == "none" or val == "":
            webclient.request(base_url + "/api/track/end", 'POST')
        else:
            payload = {
                "title": val
            }
            webclient.request(
                base_url + "/api/track",
                'POST',
                header={'Content-Type': 'application/json'},
                data=json.dumps(payload)
            )

    return
"""
    
    osc_callbacks.text = callback_script
    
    # 7. Create Parameter Execute DAT to handle the UI buttons
    ui_exec = base.create(parameterexecuteDAT, 'ui_exec')
    ui_exec.nodeX = 600
    ui_exec.nodeY = 0
    ui_exec.par.pars = 'Clearall Statepre Stateactive Statepost Updatetrack'
    
    ui_script = """# Parameter Execute Script for UI Buttons
import json

def onPulse(par):
    webclient = op('webclient1')
    base_url = webclient.par.url.eval()
    
    if par.name == 'Clearall':
        print("UI: Triggered Clear All Metrics")
        webclient.request(base_url + "/api/metrics/reset", 'POST')
        
    elif par.name == 'Statepre':
        print("UI: Setting Lobby State")
        webclient.request(
            base_url + "/api/state", 'POST',
            header={'Content-Type': 'application/json'},
            data=json.dumps({"newState": "PRE_SHOW"})
        )
        
    elif par.name == 'Stateactive':
        print("UI: Setting Active State")
        webclient.request(
            base_url + "/api/state", 'POST',
            header={'Content-Type': 'application/json'},
            data=json.dumps({"newState": "ACTIVE"})
        )
        
    elif par.name == 'Statepost':
        print("UI: Setting Ended State")
        webclient.request(
            base_url + "/api/state", 'POST',
            header={'Content-Type': 'application/json'},
            data=json.dumps({"newState": "POST_SHOW"})
        )
        
    elif par.name == 'Updatetrack':
        track_name = parent().par.Tracktitle.eval()
        print(f"UI: Sending Track Update '{track_name}'")
        if track_name.lower() == "none" or track_name == "":
            webclient.request(base_url + "/api/track/end", 'POST')
        else:
            webclient.request(
                base_url + "/api/track", 'POST',
                header={'Content-Type': 'application/json'},
                data=json.dumps({"title": track_name})
            )
            
    return
"""
    ui_exec.text = ui_script

    
    print("Successfully built OSC to REST Bridge inside /project1/osc_to_rest_bridge")

def setup_concert_kiosks():
    root = op('/')
    project = root.op('project1')
    
    base_name = 'ConcertAppKiosks'
    existing = project.findChildren(name=base_name, depth=1)
    if existing:
        existing[0].destroy()
        
    kiosks_base = project.create(baseCOMP, base_name)
    kiosks_base.nodeX = 0
    kiosks_base.nodeY = -200
    
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
    web1.par.url.expr = "(parent().par.Prodhost.eval() if parent().par.Useprod.eval() else parent().par.Localhost.eval()) + '/kiosk.html?kiosk=1&bypass=true'"
    web1.par.active.expr = "parent().par.Active.eval()"
    web1.par.reloadsrc.expr = "parent().par.Reload"

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
    web2.par.url.expr = "(parent().par.Prodhost.eval() if parent().par.Useprod.eval() else parent().par.Localhost.eval()) + '/kiosk.html?kiosk=2&bypass=true'"
    web2.par.active.expr = "parent().par.Active.eval()"
    web2.par.reloadsrc.expr = "parent().par.Reload"

    spout2 = kiosks_base.create(spoutoutTOP, 'spout_kiosk2')
    spout2.par.sendername = 'ConcertApp_Kiosk2'
    spout2.nodeX = 0
    spout2.nodeY = 0
    spout2.inputConnectors[0].connect(web2)
    
    web_qr = kiosks_base.create(webrenderTOP, 'webrender_qr')
    web_qr.par.resolutionw = 1280
    web_qr.par.resolutionh = 720
    web_qr.nodeX = -200
    web_qr.nodeY = -200
    web_qr.par.url.expr = "(parent().par.Prodhost.eval() if parent().par.Useprod.eval() else parent().par.Localhost.eval()) + '/qr.html?bypass=true'"
    web_qr.par.active.expr = "parent().par.Active.eval()"
    web_qr.par.reloadsrc.expr = "parent().par.Reload"

    spout_qr = kiosks_base.create(spoutoutTOP, 'spout_qr')
    spout_qr.par.sendername = 'QR Code'
    spout_qr.nodeX = 0
    spout_qr.nodeY = -200
    spout_qr.inputConnectors[0].connect(web_qr)
    
    web_admin = kiosks_base.create(webrenderTOP, 'webrender_admin')
    web_admin.par.resolutionw = 1280
    web_admin.par.resolutionh = 720
    web_admin.nodeX = -200
    web_admin.nodeY = -400
    web_admin.par.url.expr = "(parent().par.Prodhost.eval() if parent().par.Useprod.eval() else parent().par.Localhost.eval()) + '/admin-console.html?password=czech&bypass=true'"
    web_admin.par.active.expr = "parent().par.Active.eval()"
    web_admin.par.reloadsrc.expr = "parent().par.Reload"

    spout_admin = kiosks_base.create(spoutoutTOP, 'spout_admin')
    spout_admin.par.sendername = 'Admin Console'
    spout_admin.nodeX = 0
    spout_admin.nodeY = -400
    spout_admin.inputConnectors[0].connect(web_admin)
    
    # --- 4. Build API Execution DAT ---
    parexec = kiosks_base.create(parameterexecuteDAT, 'api_requests')
    parexec.nodeX = -200
    parexec.nodeY = -200
    parexec.par.pars = 'Starttrack Endtrack' # Removed Reload
    
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
"""
    parexec.text = script.strip()
    
    print("Successfully created ConcertAppKiosks baseCOMP with interactive URL toggles and API bindings.")

# Execute the builder functions
build_osc_to_rest_bridge()
setup_concert_kiosks()
