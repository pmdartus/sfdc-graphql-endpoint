export interface LoggerFn {
    (msg: string, ...args: unknown[]): void;
    (obj: unknown, msg?: string, ...args: unknown[]): void;
}

export interface Logger {
    info: LoggerFn;
    warn: LoggerFn;
    error: LoggerFn;
    debug: LoggerFn;
}
