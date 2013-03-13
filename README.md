Zabbix backend for statsd
=========================

Forwards metrics from statsd to a zabbix server using zabbix_sender. 
It also sends a list of items to zabbix every time a new stat is received, so you can use Zabbix autodiscovery to create new items/triggers/graphs automatically. 

TODO
====
Send item type in autodiscovery
make key format configurable
