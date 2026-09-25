# Decision records

One short record per delegated decision (D-37). Each record mirrors a DD row in spec section 18
(`docs/DESIGN.md`). DD-01 to DD-09 were made by the designer's delegation before the build started and
live only in the spec. Add a new one with:

```sh
pnpm tsx scripts/add-decision.ts "<decision>" "<why it is the best case>" --slug short-name --refs "5.4"
```
