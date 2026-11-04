export class LoadError extends Error {
  constructor(
    public path: string,
    msg: string,
    public request_id?: string,
    public code?: number,
    public gap_flags?: string[],
  ) {
    super(msg);
    this.name = "LoadError";
  }
}
