export type Ok<T> = { done: true } & T;

export type Err<E extends string = string> = {
  done: false;
  error: E;
};

export type Result<T, E extends string = string> = Ok<T> | Err<E>;
