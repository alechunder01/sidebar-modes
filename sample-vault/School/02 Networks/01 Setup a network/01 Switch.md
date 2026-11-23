# Switch basics

## First steps
```
enable
configure terminal
hostname SW1
no ip domain-lookup
```

## Save the configuration
```
copy running-config startup-config
```

## Useful show commands
```
show running-config       current configuration
show ip interface brief   interface status at a glance
show mac address-table    which MAC is behind which port
```

> [!tip]
> `?` shows the available commands at any point, `Tab` completes them.
