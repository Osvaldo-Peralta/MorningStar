export type FieldChange<T> = {
  before: T
  after: T
}

export type PhotoChanges = {
  url?: FieldChange<string>
}
