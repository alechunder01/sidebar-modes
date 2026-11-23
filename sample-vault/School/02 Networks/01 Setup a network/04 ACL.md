# ACL (Access Control Lists)

An ACL is an ordered list of `permit` / `deny` rules, checked top to bottom. The first match wins.

| Type | Filters on | Place it |
| --- | --- | --- |
| Standard | source address only | close to the destination |
| Extended | source, destination, protocol, port | close to the source |

```
ip access-list extended BLOCK-HR-TO-IT
  deny ip 192.168.20.0 0.0.0.255 192.168.10.0 0.0.0.255
  permit ip any any
interface gig0/0/1.20
  ip access-group BLOCK-HR-TO-IT in
```

> [!warning]
> Every ACL ends with an invisible `deny any`. If nothing permits the traffic, it is dropped.
