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
    osc_start_path = settings_page.appendStr('Oscstartpath', label='Track Start OSC Path')[0]
    osc_stop_path = settings_page.appendStr('Oscstoppath', label='Track Stop OSC Path')[0]
    
    local_host.val = 'http://localhost:8000'
    prod_host.val = 'https://concert-app-r52d.onrender.com'
    osc_port.val = 9001
    osc_start_path.val = '/track/start'
    osc_stop_path.val = '/track/stop'

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
    start_path = op('..').par.Oscstartpath.eval()
    stop_path = op('..').par.Oscstoppath.eval()
    
    raw_message = str(dat[rowIndex, 0].val)
    parts = raw_message.split()
    address = parts[0] if len(parts) > 0 else ""
    argument_val = parts[1] if len(parts) > 1 else ""
    
    # Try to clean the incoming argument into a strict integer (Resolume sends floats like '1.00001')
    try:
        clean_id = str(int(float(argument_val)))
    except ValueError:
        clean_id = argument_val
    
    # Only forward specific addresses
    if address == start_path:
        print(f"OSC Track Start Received: {clean_id}")
        payload = {
            "id": clean_id,
            "title": "Track " + clean_id
        }
        
        # We need to send as JSON for your express backend config
        json_payload = json.dumps(payload)
        
        webclient.request(
            base_url + "/api/track",
            'POST',
            header={'Content-Type': 'application/json'},
            data=json_payload
        )
        
    elif address == stop_path:
        print(f"OSC Track Stop Received")
        webclient.request(
            base_url + "/api/track/end",
            'POST'
        )

    return
"""
    
    osc_callbacks.text = callback_script
    print("Successfully built OSC to REST Bridge inside /project1/osc_to_rest_bridge")

# Execute the builder function
build_osc_to_rest_bridge()
