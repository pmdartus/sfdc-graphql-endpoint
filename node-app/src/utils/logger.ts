export interface LoggerFn {
    (...args: any[]): void;
}

export interface Logger {
    info: LoggerFn;
    warn: LoggerFn;
    error: LoggerFn;
    debug: LoggerFn;
}
