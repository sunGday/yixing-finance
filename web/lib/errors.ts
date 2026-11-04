export class LoadError extends Error { constructor(public path: string, msg: string, public request_id?: string) { super(msg); } }
