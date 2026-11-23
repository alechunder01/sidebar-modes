# VLANs

## 1. Create the VLANs
```
vlan 10
 name IT
vlan 20
 name HR
```

## 2. Assign access ports
```
interface range fa0/1 - 8
  switchport mode access
  switchport access vlan 10
```

## 3. Trunk to the router
```
interface gig0/1
  switchport mode trunk
  switchport trunk allowed vlan 10,20
```

## Verify
```
show vlan brief
show interfaces trunk
```
- an access port belongs to one VLAN
- a trunk carries several VLANs over one cable
