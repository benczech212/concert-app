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
    # Use WSL IP instead of localhost so TouchDesigner (Windows) can reach it
    web_client.par.url = "http://172.29.191.61:8000/api/track"
    
    # Optional: ensure we parse JSON responses if needed
    # web_client.par.output = 'json'

    # 4. Create or grab the Text DAT for the OSC In callbacks
    callback_dat_name = osc_in.par.callbacks.eval()
    
    # Let's ensure TouchDesigner's auto-generation doesn't accidentally wire it
    # We don't need a wired connection, just the parameter reference
    osc_callbacks = base.op(callback_dat_name)
    if not osc_callbacks:
        osc_callbacks = base.create(textDAT, callback_dat_name if callback_dat_name else 'oscin1_callbacks')
        osc_in.par.callbacks = osc_callbacks.name
        
    osc_callbacks.nodeX = 0
    osc_callbacks.nodeY = 0
    
    # Break any physical wire connections to prevent cook loops!
    osc_callbacks.inputConnectors[0].disconnect()

    # 6. Write the Python logic inside the callback DAT
    callback_script = """# OSC In DAT Callback script
import json

def onReceiveOSC(dat, rowIndex, message, bytes, timeStamp, source, sendPort, receivePort):
    # This runs every time an OSC message is received
    
    # Retrieve the Web Client DAT
    webclient = op('webclient1')
    
    # Extract the address and argument from the incoming message
    raw_message = str(dat[rowIndex, 0].val)
    
    # Since we removed 'numstrings' format, it defaults to a combined string like:
    # '/track/update 0' 
    parts = raw_message.split()
    address = parts[0] if len(parts) > 0 else "Unknown"
    argument_val = parts[1] if len(parts) > 1 else "Unknown"
    
    # -- LOGGING: Print the raw incoming details to the TouchDesigner Textport --
    print(f"--- OSC Message Received on port {receivePort} ---")
    print(f"Address: {address}")
    print(f"Argument 1: {argument_val}")
    print("---------------------------------")
    
    # Formulate the JSON payload for the Node.js API
    # Assuming 'argument_val' matches the track ID
    payload = {
        "trackId": int(argument_val) if argument_val.isdigit() else argument_val,
        "title": "Track " + argument_val if argument_val != "Unknown" else "Unknown"
    }
    
    # TouchDesigner's built-in way to send body parameters easily is via a dictionary
    # assigned to the 'data' keyword argument. 
    # This automatically sets Content-Type to application/x-www-form-urlencoded
    webclient.request(
        webclient.par.url.eval(),
        'POST',
        data=payload
    )

    return
"""
    
    osc_callbacks.text = callback_script
    
    print("Successfully built OSC to REST Bridge inside /project1/osc_to_rest_bridge")

# Execute the builder function
build_osc_to_rest_bridge()
