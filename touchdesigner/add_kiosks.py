def add_kiosk_nodes():
    # Use the parent of this script so nodes spawn right here in /project1
    root_comp = me.parent()
    
    # Create nodes for Kiosk 1 (note: TD class names are typically lowercase for the first word)
    web1 = root_comp.create(webrenderTOP, 'webrender_kiosk1')
    web1.par.url = 'http://localhost:8000/kiosk1.html'
    web1.par.resolutionw = 1280
    web1.par.resolutionh = 720
    web1.nodeX = 0
    web1.nodeY = -200

    spout1 = root_comp.create(spoutoutTOP, 'spout_kiosk1')
    spout1.par.sendername = 'ConcertApp_Kiosk1'
    spout1.nodeX = 200
    spout1.nodeY = -200
    
    # Wire them up
    spout1.inputConnectors[0].connect(web1)

    # Create nodes for Kiosk 2
    web2 = root_comp.create(webrenderTOP, 'webrender_kiosk2')
    web2.par.url = 'http://localhost:8000/kiosk2.html'
    web2.par.resolutionw = 1280
    web2.par.resolutionh = 720
    web2.nodeX = 0
    web2.nodeY = -400

    spout2 = root_comp.create(spoutoutTOP, 'spout_kiosk2')
    spout2.par.sendername = 'ConcertApp_Kiosk2'
    spout2.nodeX = 200
    spout2.nodeY = -400
    
    # Wire them up
    spout2.inputConnectors[0].connect(web2)

    print("Successfully created Web Render and Spout Out nodes for Kiosk 1 and Kiosk 2.")

add_kiosk_nodes()
