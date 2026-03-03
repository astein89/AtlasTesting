declare module 'sql.js' {
  export interface BindParams {
    [key: string]: string | number | null
  }
  export interface QueryExecResult {
    columns: string[]
    values: (string | number | null)[][]
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database
  }
  export interface Database {
    run(sql: string, params?: (string | number | null)[] | BindParams): void
    exec(sql: string): QueryExecResult[]
    getRowsModified(): number
    export(): Uint8Array
    prepare(sql: string): Statement
  }
  export interface Statement {
    bind(params?: (string | number | null)[] | BindParams): boolean
    step(): boolean
    getAsObject(): Record<string, string | number | null>
    get(config?: { useBigInt?: boolean }): (string | number | null)[]
    free(): void
  }
  export default function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>
}
