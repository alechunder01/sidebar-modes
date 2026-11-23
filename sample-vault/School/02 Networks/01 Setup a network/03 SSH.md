# SSH

```
ip domain-name lab.local
crypto key generate rsa modulus 2048
username admin secret StrongPass123
line vty 0 4
  transport input ssh
  login local
```
- prefer SSH over Telnet, Telnet sends everything in plain text
- use `ip ssh version 2`
