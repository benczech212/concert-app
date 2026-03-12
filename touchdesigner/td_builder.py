# td_builder.py
# Run this script in TouchDesigner (e.g. inside a Text DAT then right-click -> "Run Script")
# This will procedurally build the network for receiving OSC messages and sending REST HTTP requests

def setup_concert_companion():
    root = op('/')
    project = root.op('project1')
    
    # --- 1. Master Container ---
    master_name = 'concert_app_companion'
    existing = project.findChildren(name=master_name, depth=1)
    if existing:
        existing[0].destroy()
        
    master = project.create(baseCOMP, master_name)
    master.nodeX = 0
    master.nodeY = 0

    # --- 2. Master Settings Parameters ---
    settings_page = master.appendCustomPage('Settings')
    use_prod = settings_page.appendToggle('Useprod', label='Use Production')[0]
    local_host = settings_page.appendStr('Localhost', label='Local Host')[0]
    prod_host = settings_page.appendStr('Prodhost', label='Prod Host')[0]
    osc_port = settings_page.appendInt('Oscport', label='OSC Port')[0]
    osc_show_update = settings_page.appendStr('Oscshowupdatepath', label='Show Update OSC Path')[0]
    osc_track_update = settings_page.appendStr('Osctrackupdatepath', label='Track Update OSC Path')[0]
    
    # Actions
    settings_page.appendPulse('Clearall', label='Clear Data')
    settings_page.appendPulse('Statepre', label='Set Lobby State')
    settings_page.appendPulse('Stateactive', label='Set Active State')
    settings_page.appendPulse('Statepost', label='Set Ended State')
    
    track_title = settings_page.appendStr('Tracktitle', label='Track Title')[0]
    settings_page.appendPulse('Updatetrack', label='Send Track Update')
    
    # Defaults
    use_prod.val = False
    local_host.val = 'http://localhost:8000'
    prod_host.val = 'https://concert-app-r52d.onrender.com'
    osc_port.val = 7001
    osc_show_update.val = '/show/update'
    osc_track_update.val = '/track/update'
    track_title.val = "My New Track"

    # --- 3. Sub-Component: OSC to REST Bridge ---
    bridge = master.create(baseCOMP, 'osc_to_rest_bridge')
    bridge.nodeX = -200
    bridge.nodeY = 200

    osc_in = bridge.create(oscinDAT, 'oscin1')
    osc_in.nodeX = 0
    osc_in.nodeY = 200
    osc_in.par.port.expr = "parent(2).par.Oscport.eval()"
    
    osc_out = bridge.create(outDAT, 'out1')
    osc_out.nodeX = 0
    osc_out.nodeY = -150
    osc_out.inputConnectors[0].connect(osc_in)
    bridge.par.opviewer = osc_in.path

    web_client = bridge.create(webclientDAT, 'webclient1')
    web_client.nodeX = 400
    web_client.nodeY = 0
    web_client.par.url.expr = "parent(2).par.Prodhost.eval() if parent(2).par.Useprod.eval() else parent(2).par.Localhost.eval()"
    
    callback_dat_name = osc_in.par.callbacks.eval()
    osc_callbacks = bridge.op(callback_dat_name)
    if not osc_callbacks:
        osc_callbacks = bridge.create(textDAT, callback_dat_name if callback_dat_name else 'oscin1_callbacks')
        osc_in.par.callbacks = osc_callbacks.name
    osc_callbacks.nodeX = 0
    osc_callbacks.nodeY = 0
    osc_callbacks.inputConnectors[0].disconnect()

    callback_script = """# OSC In Callback Script
import json

def onReceiveOSC(dat, rowIndex, message, bytes, timeStamp, source, sendPort, receivePort):
    webclient = op('webclient1')
    base_url = webclient.par.url.eval()
    
    # Climb up from oscin1_callbacks -> osc_to_rest_bridge -> master
    master_comp = op('..').parent()
    show_update_path = master_comp.par.Oscshowupdatepath.eval()
    track_update_path = master_comp.par.Osctrackupdatepath.eval()
    
    address = str(dat[rowIndex, 0].val)
    val = ""
    if dat.numCols > 1:
        val = str(dat[rowIndex, 1].val)
    else:
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
                base_url + "/api/state", 'POST',
                header={'Content-Type': 'application/json'},
                data=json.dumps({"newState": state_map[val.lower()]})
            )
            
    elif address == track_update_path:
        print(f"OSC Track Update Received: {val}")
        if val.lower() == "none" or val == "":
            webclient.request(base_url + "/api/track/end", 'POST')
        else:
            payload = {"title": val}
            webclient.request(
                base_url + "/api/track", 'POST',
                header={'Content-Type': 'application/json'},
                data=json.dumps(payload)
            )
            
    elif address == "/track/stop":
        print(f"OSC Track Stop Received")
        webclient.request(base_url + "/api/track/end", 'POST')
        
    return
"""
    osc_callbacks.text = callback_script
    
    ui_exec = master.create(parameterexecuteDAT, 'ui_exec')
    ui_exec.nodeX = 400
    ui_exec.nodeY = 200
    ui_exec.par.pars = 'Clearall Statepre Stateactive Statepost Updatetrack'
    
    ui_script = """# Parameter Execute Script for UI Buttons
import json

def onPulse(par):
    master = par.owner
    host = master.par.Prodhost.eval() if master.par.Useprod.eval() else master.par.Localhost.eval()
    webclient = op('osc_to_rest_bridge/webclient1')
    
    if par.name == 'Clearall':
        url = host + "/api/metrics/reset"
        print(f"UI: Triggered Clear All Metrics -> {url}")
        webclient.request(url, 'POST')
        
    elif par.name == 'Statepre':
        url = host + "/api/state"
        print(f"UI: Setting Lobby State -> {url}")
        webclient.request(url, 'POST', header={'Content-Type': 'application/json'}, data=json.dumps({"newState": "PRE_SHOW"}))
        
    elif par.name == 'Stateactive':
        url = host + "/api/state"
        print(f"UI: Setting Active State -> {url}")
        webclient.request(url, 'POST', header={'Content-Type': 'application/json'}, data=json.dumps({"newState": "ACTIVE"}))
        
    elif par.name == 'Statepost':
        url = host + "/api/state"
        print(f"UI: Setting Ended State -> {url}")
        webclient.request(url, 'POST', header={'Content-Type': 'application/json'}, data=json.dumps({"newState": "POST_SHOW"}))
        
    elif par.name == 'Updatetrack':
        track_name = master.par.Tracktitle.eval()
        print(f"UI: Sending Track Update '{track_name}'")
        if track_name.lower() == "none" or track_name == "":
            webclient.request(host + "/api/track/end", 'POST')
        else:
            webclient.request(host + "/api/track", 'POST', header={'Content-Type': 'application/json'}, data=json.dumps({"title": track_name}))
    return
"""
    ui_exec.text = ui_script

    # --- 4. Sub-Component: Web Renderers ---
    kiosks = master.create(baseCOMP, 'ConcertAppKiosks')
    kiosks.nodeX = -200
    kiosks.nodeY = 0
    
    page = kiosks.appendCustomPage('Settings')
    is_active = page.appendToggle('Active', label='Active')[0]
    is_active.val = True
    page.appendPulse('Reload', label='Reload Source')

    # Master UI Container (what you actually display)
    ui_master = master.create(containerCOMP, 'ui_master')
    ui_master.nodeX = 200
    ui_master.nodeY = -100
    ui_master.par.w = 1280
    ui_master.par.h = 720

    # Viewers Base Container (inside the master UI container)
    viewers = ui_master.create(containerCOMP, 'web_viewers')
    viewers.nodeX = 0
    viewers.nodeY = 0
    viewers.par.align = 0 # Left to Right (Left Col vs Admin)
    viewers.par.hmode = 1
    viewers.par.vmode = 1

    # Left Column Container
    left_col = viewers.create(containerCOMP, 'left_col')
    left_col.par.align = 1 # vertbt
    left_col.par.hmode = 1
    left_col.par.vmode = 1
    
    # Row 1 Container (Kiosks)
    row_1 = viewers.create(containerCOMP, 'row_1')
    row_1.par.align = 4 # gridrows
    row_1.par.hmode = 1
    row_1.par.vmode = 1
    
    # Row 2 Container (QR & Post-Show)
    row_2 = viewers.create(containerCOMP, 'row_2')
    row_2.par.align = 4 # gridrows
    row_2.par.hmode = 1
    row_2.par.vmode = 1
    
    # Root Layout Anchor (Top to Bottom)
    out1 = viewers.create(containerCOMP, 'out1')
    out1.par.align = 4 # gridrows
    out1.par.vmode = 2 
    out1.par.bottomanchor = 0.35
    out1.par.w = 400
    out1.par.h = 300
    
    # Wire the skeleton bounds
    out1.outputCOMPConnectors[0].connect(left_col)
    left_col.outputCOMPConnectors[0].connect(row_1)
    left_col.outputCOMPConnectors[0].connect(row_2)
    
    renders = [
        {'name': 'kiosk1', 'path': '/kiosk.html?kiosk=1&bypass=true', 'target': row_1},
        {'name': 'kiosk2', 'path': '/kiosk.html?kiosk=2&bypass=true', 'target': row_1},
        {'name': 'qr', 'path': '/qr.html?bypass=true', 'target': row_2},
        {'name': 'post_show', 'path': '/post-show.html?bypass=true', 'target': row_2},
        {'name': 'admin', 'path': '/admin-console.html?password=czech&bypass=true', 'target': out1}
    ]
    
    for i, r in enumerate(renders):
        # Webrender TOP
        web = kiosks.create(webrenderTOP, f"webrender_{r['name']}")
        web.par.resolutionw = 1280
        web.par.resolutionh = 720
        web.nodeX = -200
        web.nodeY = 200 - (i * 200)
        web.par.url.expr = f"(parent(2).par.Prodhost.eval() if parent(2).par.Useprod.eval() else parent(2).par.Localhost.eval()) + '{r['path']}'"
        web.par.active.expr = "parent().par.Active.eval()"
        web.par.reloadsrc.expr = "parent().par.Reload"

        # Spout Out TOP
        if r['name'] != 'admin':
            spout = kiosks.create(spoutoutTOP, f"spout_{r['name']}")
            spout.par.sendername = f"ConcertApp_{r['name'].capitalize()}"
            spout.nodeX = 0
            spout.nodeY = 200 - (i * 200)
            spout.inputConnectors[0].connect(web)
        
        # OP Viewer created flated in web_viewers base
        opview = viewers.create(opviewerCOMP, f"opviewer_{r['name']}")
        opview.par.opviewer = web.path
        opview.par.hmode = 1 
        opview.par.vmode = 1
        
        # Wire it into the dynamic Layout graph
        r['target'].outputCOMPConnectors[0].connect(opview)

    ui_master.par.clone = viewers.path
    ui_master.par.enablecloning = True

    print("Successfully built Master Companion App inside /project1/concert_app_companion")

# Execute the builder functions
setup_concert_companion()
