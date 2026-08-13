# IDL placeholder

After `anchor build`, copy:

```
target/idl/bullet.json  →  frontend/src/idl/bullet.json
```

Then wire `getProgram()` in `src/lib/bullet.ts` to load it.
