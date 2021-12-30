export interface LoggerFn {
    (...args: unknown[]): void;
}

export interface Logger {
    info: LoggerFn;
    warn: LoggerFn;
    error: LoggerFn;
    debug: LoggerFn;
}
