import {describe, test, jest, beforeEach, expect} from '@jest/globals';
import {CircuitBreaker} from "./index";

function setNow(ms: number) {
    Date.now = jest.fn(() => ms);
}

const mstos = (ms: number) => Math.floor(ms / 1_000);
const stoms = (s: number) => Math.floor(s * 1_000);

describe("CircuitBreaker", () => {

    describe("defaults", () => {
        const defaultDelay = 1_000;
        let circuitBreaker: CircuitBreaker;

        beforeEach(() => {
           circuitBreaker = new CircuitBreaker({name: "test-circuit-breaker"});
        });

        test("activate is active until delay ends!", () => {
            const startTime = stoms(1 + Math.random())
            setNow(startTime);
            // multiple calls shouldn't be active
            for (let i = 1; i < 10; i++) {
                expect(circuitBreaker.active()).toBeFalsy();
            }

            //activate the circuit breaker
            circuitBreaker.activate();

            // multiple calls, beneath the default delay should be active
            for (let i = 1; i < defaultDelay; i+= stoms(1)) {
                setNow(stoms(i + Math.random()));
                expect(circuitBreaker.active()).toBeTruthy();
            }

            // once the default delay is exceeded by 1 ms, it should no longer be active
            setNow(defaultDelay + startTime);
            expect(circuitBreaker.active()).toBeFalsy();
        });

        test("works through multiple activates", () => {
            setNow(1);

            for (let i = 0; i < 10; i++) {
                const currTime = (defaultDelay * i) + 1;

                setNow(currTime);
                circuitBreaker.activate();
                for (let j = 0; j < defaultDelay; j += 100) {
                    setNow(j + currTime);
                    expect(circuitBreaker.active()).toBeTruthy()
                }

                for (let j = defaultDelay * (i + 1) + 1; j < defaultDelay * (i + 2); j += 100) {
                    setNow(j + currTime);
                    expect(circuitBreaker.active()).toBeFalsy();
                }
            }
        });

        describe("timings activate circuitBreaker as expected", () => {
            test("single value pushes over threshold", () => {
                for (let i = 1; i <= 10; i++) {
                    setNow(stoms(i + Math.random()));
                    circuitBreaker.addSuccess({timings: 999});
                    expect(circuitBreaker.active()).toBeFalsy();
                }

                expect(circuitBreaker.active()).toBeFalsy();

                // (9 * 1000) - (999 * 8 + 1007) = 1008.. so 1007 will still be false
                setNow(stoms(11 + Math.random()));
                circuitBreaker.addSuccess({timings: 1007});
                expect(circuitBreaker.active()).toBeFalsy();

                // (9 * 1000) - (999 * 7 + 1007) / 9 = 1000
                setNow(stoms( 12 + Math.random()))
                circuitBreaker.addSuccess({timings: 1000});
                expect(circuitBreaker.active()).toBeTruthy();

            });

            test("activates even once threshold is hit, even events are in same bucket", () => {
                setNow(stoms(1 + Math.random()));
                for (let i = 0; i < 25; i++) {
                    circuitBreaker.addSuccess({timings: 999});
                    expect(circuitBreaker.active()).toBeFalsy();
                }

                // (26 * 1000) - (25 * 999) = 1025, 1024 should keep it still not active
                circuitBreaker.addSuccess({timings: 1024});
                expect(circuitBreaker.active()).toBeFalsy()

                // (27 * 1000) - (25 * 999 + 1024) = 1001
                circuitBreaker.addSuccess({timings: 1001});
                expect(circuitBreaker.active()).toBeTruthy();
            })

            test("doesn't activate until minimum number of successes have occurred!", () => {
                for (let i = 0; i < 7; i++) {
                    setNow(stoms(i + 1));
                    circuitBreaker.addSuccess({timings: 100_000});
                    expect(circuitBreaker.active()).toBeFalsy();
                }

                // activates even if we have very fast timing, because average
                // has shifted
                setNow(stoms(8));
                circuitBreaker.addSuccess({timings: 1});
                expect(circuitBreaker.active()).toBeTruthy();
            });

            test("random spikes below the threshold, dont activate circuit breaker", () => {
                for (let i = 0; i < 100; i++) {
                    setNow(stoms(i + 1));
                    for (let j = 0; j < 10; j++) {
                        // this operation empirically clocked around 66micros
                        circuitBreaker.addSuccess({timings: 999});
                        expect(circuitBreaker.active()).toBeFalsy();
                    }

                    if (i % 10 == 0 && i > 0) {
                        // ((9 * 100 + 1) * 1000) - (8 * 100 * 999) = 1800
                        circuitBreaker.addSuccess({timings: 1080 - 1});
                        expect(circuitBreaker.active()).toBeFalsy();
                    }
                }
            })

            test("spikes above threshold activate the circuit breaker", () => {
                let currTime = 0;

                for (let i = 0; i < 100; i++) {
                    currTime += stoms(1)
                    setNow(currTime);
                    for (let j = 0; j < 10; j++) {
                        circuitBreaker.addSuccess({timings: 999});
                        expect(circuitBreaker.active()).toBeFalsy();
                    }

                    setNow(currTime + 100);
                    circuitBreaker.addSuccess({timings: 10_000});
                    expect(circuitBreaker.active()).toBeTruthy();

                    currTime += stoms(10 + 1);
                    setNow(currTime);
                    expect(circuitBreaker.active()).toBeFalsy();
                }
            });
        });
    })
});