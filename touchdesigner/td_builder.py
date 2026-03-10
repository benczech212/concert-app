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

    # 2. Create the OSC In DAT to receive from Resolume
    osc_in = base.create(oscinDAT, 'oscin1')
    osc_in.nodeX = 0
    osc_in.nodeY = 200
    osc_in.par.port = 9001 # Default port, adjust if Resolume uses something else

    # 3. Create the Web Client DAT to send to Node.js backend
    web_client = base.create(webclientDAT, 'webclient1')
    web_client.nodeX = 400
    web_client.nodeY = 0
    web_client.par.url = "https://concert-app-r52d.onrender.com"
    
    # 4. Create or grab the Text DAT for the OSC In callbacks
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
    
    raw_message = str(dat[rowIndex, 0].val)
    parts = raw_message.split()
    address = parts[0] if len(parts) > 0 else ""
    argument_val = parts[1] if len(parts) > 1 else ""
    
    # Only forward specific addresses
    if address == "/track/start":
        print(f"OSC Track Start Received: {argument_val}")
        payload = {
            "id": argument_val,
            "title": "Track " + argument_val
        }
        
        # We need to send as JSON for your express backend config
        json_payload = json.dumps(payload)
        
        webclient.request(
            base_url + "/api/track",
            'POST',
            header1Name="Content-Type",
            header1Value="application/json",
            data=json_payload
        )
        
    elif address == "/track/stop":
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
