
interface CircuitBreakerInterface {
    run: <T> (fn: () => Promise<T>) => Promise<T>
    active: () => boolean
    activate: () => void
    addSuccess: (args?: {timings?: number}) => void
    addError: (args?: {timings?: number}) => void
}

export class CircuitBreakerError extends Error {
    private readonly statusCode: number;
    constructor(statusCode: number, ...args: any[]) {
        super(...args);
        this.statusCode = statusCode;
    }
}


export class CircuitBreaker implements CircuitBreakerInterface {
    private readonly name;
    private readonly log: (msg: string) => void
    private readonly delay: (timesTrigger: number, lastTimeTriggered: number, lastDelay: number) => number
    private readonly shouldActivate: () => boolean;

    private readonly movingWindowSizeSeconds: number;
    private readonly successes: number[];
    private readonly totalTimings: number[];
    private readonly errors: number[];

    private lastTimeTriggered: number;
    private timesTriggered: number;
    private lastUpdateAt: number;
    private inactiveAt: number;
    private lastDelay: number;

    public constructor(args: {
        name: string,
        log?: (msg: string) => void,
        movingWindowSizeSeconds?: number,
        maxErrorRate?: number,
        maxTimingsMs?: number,
        minSuccessesForTimings?: number,
        delay?: (number | ((timesTriggered: number, lastDelay: number) => number)),
        shouldActivate?: (attempts: number[], timings: number[], errors: number[]) => boolean;
        debugRate?: number;
    }) {
        this.lastTimeTriggered = 0;
        this.timesTriggered = 0;
        this.lastUpdateAt = 0;
        this.inactiveAt = 0;
        this.lastDelay = 0

        this.movingWindowSizeSeconds = args?.movingWindowSizeSeconds ?? 10;

        this.successes = new Array(this.movingWindowSizeSeconds).fill(0);
        this.totalTimings = new Array(this.movingWindowSizeSeconds).fill(0);
        this.errors = new Array(this.movingWindowSizeSeconds).fill(0);

        this.name = args.name;

        this.log = (msg: string) => (args?.log) ? args.log(`CircuitBreaker [${this.name}] - ${msg}`) : {};

        this.delay = (args?.delay && typeof args?.delay === 'function')
            ? args.delay
            : (_timesTriggered, _lastDelay) => (args?.delay && typeof args?.delay === 'number') ? args?.delay : 1_000;

        if (args?.shouldActivate && (args.maxErrorRate || args.maxTimingsMs || args.minSuccessesForTimings)) {
            throw new Error("Cannot supply maxErrorRate/maxTimingsMs/minSuccessesForTimings with custom shouldActivate function!");
        }

        if (args?.debugRate && (!args?.log || args?.shouldActivate)) {
            throw new Error("Cannot setup debugRate without log provided, or with custom shouldActivate function!");
        }

        const maxErrorRate = args?.maxErrorRate ?? 0.1;
        const maxTimings = args?.maxTimingsMs ?? 1_000;
        const minAttempts = args?.minSuccessesForTimings ?? 8;
        const shouldActivate = args?.shouldActivate;

        this.shouldActivate = shouldActivate
            ? () => shouldActivate(this.successes, this.totalTimings, this.errors)
            : () => {
                const sumSuccesses = this.successes.reduce((agg, v) => agg + v, 0.0);
                const sumTimings = this.totalTimings.reduce((agg, v) => agg + v, 0.0);
                const sumErrors = this.errors.reduce((agg, v) => agg + v, 0.0);

                const sumAttempts = sumSuccesses + sumErrors;

                const errRate = sumErrors / sumAttempts;
                const avgTiming = sumTimings / sumAttempts;

                if (args.debugRate && args?.log) {
                    if (Math.random() < args.debugRate) {
                        args.log("debug shouldActivate data=" + JSON.stringify({
                            successes: this.successes,
                            totalTimings: this.totalTimings,
                            errors: this.errors,
                            sumAttempts,
                            sumTimings,
                            sumSuccesses,
                            sumErrors,
                            errRate,
                            avgTiming,
                            minAttempts,
                            maxTimings,
                            maxErrorRate
                        }));
                    }
                }

                return Boolean(
                    errRate > maxErrorRate ||
                    (sumAttempts >= minAttempts && avgTiming >= maxTimings)
                );
            };
    }

    run<T>(fn: () => Promise<T>): Promise<T> {
        const start = Date.now();
        return new Promise<T>(() => {
            if (this.active()) {
                throw new CircuitBreakerError(429, "killswitch engaged!");
            }
            return fn();
        })
        .then(result => {
            this.addSuccess({timings: Date.now() - start});
            return result;
        })
        .catch(err => {
            this.addError({timings: Date.now() - start});
            throw err;
        });
    }

    activate(): void {
        const now = Date.now();
        const timeToCooldown = this.delay(this.timesTriggered, this.lastTimeTriggered, this.lastDelay);
        this.inactiveAt = now + timeToCooldown;
        this.log(`triggered now at ${now}ms until ${this.inactiveAt}ms (delay=${timeToCooldown})!`);
        this.timesTriggered += 1;
        this.lastDelay = timeToCooldown;
    }

    active(): boolean {
        const remainingTimeActive = this.inactiveAt - Date.now();
        if (remainingTimeActive > 0) {
            this.log(`active! time remaining ${remainingTimeActive}ms!`);
            this.resetData();
            this.lastUpdateAt = 0;
            return true;
        }

        if (this.shouldActivate()) {
            this.activate();
            this.resetData();
            return true;
        }

        return false;
    }

    addSuccess(args: { timings?: number } | undefined): void {
        const now = Date.now();
        const currIdx = Math.floor((now / 1_000)) % this.movingWindowSizeSeconds;
        this.clearStaleData(currIdx, now);

        if (args?.timings) {
            this.totalTimings[currIdx] += args.timings;
        }

        this.successes[currIdx]++
        this.lastUpdateAt = now;
    }

    addError(args: { timings?: number } | undefined): void {
        const now = Date.now();
        const currIdx = Math.floor((now / 1_000)) % this.movingWindowSizeSeconds;
        this.clearStaleData(currIdx, now);

        if (args?.timings) {
            this.totalTimings[currIdx] += args.timings;
        }

        this.errors[currIdx]++;
        this.lastUpdateAt = now;
    }

    private clearStaleData(currIndex: number, now: number) {
        const bucketsJumped = Math.floor(now / 1000) - Math.floor(this.lastUpdateAt / 1000);
        if (bucketsJumped > this.movingWindowSizeSeconds) {
            this.resetData();
        } else {
            // clear out the buckets on every future index
            // that goes past the last value we tried to alter
            for (let i = 1; i <= bucketsJumped; i++) {
                const idx = (currIndex + i) % this.movingWindowSizeSeconds;
                this.totalTimings[idx] = 0;
                this.successes[idx] = 0;
                this.errors[idx] = 0;
            }
        }
    }

    private resetData(): void {
        for (let i = 0; i < this.movingWindowSizeSeconds; i++) {
            this.totalTimings[i] = 0;
            this.successes[i] = 0;
            this.errors[i] = 0;
        }
    }
}