![image](.docs/iso-electrocution-voltage-hazard-symbol.png)  
# circuit-breaker-js

The goal is simple. You are the circuit. If you notice someone getting 
eletrocuted. You should probably stop!

## Description

Circuit Breakers are a common pattern we see in high volume, high throughput 
services at [ATG](https://www.accretivetg.com/).

Some of our high throughput services will deliver thousands if not millions of
requests in short windows. Sometimes resources underneath are rotating and experience failure,
they are deploying and are more resource constrainted, or we are receieving a massive influx of
traffic for many other reasons.

This library provides a no dependencies implementation of a lightweight circuit breaker
designed to resolve issues when you hit them.

## How to Use

```
npm install 
```
