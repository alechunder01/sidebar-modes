# LaTeX Cheat Sheet
Inline `$...$`, display `$$...$$`.

| Want | Write | Result |
| --- | --- | --- |
| fraction | `\frac{a}{b}` | $\frac{a}{b}$ |
| power / index | `x^2`, `x_1` | $x^2$, $x_1$ |
| square root | `\sqrt{x}` | $\sqrt{x}$ |
| sum | `\sum_{i=1}^{n} i` | $\sum_{i=1}^{n} i$ |
| integral | `\int_a^b f\,dx` | $\int_a^b f\,dx$ |
| Greek | `\alpha \beta \varepsilon \mu \pi` | $\alpha \beta \varepsilon \mu \pi$ |
| units | `\mathrm{N\,m}` | $\mathrm{N\,m}$ |
| vector | `\vec{F}` | $\vec{F}$ |
| boxed result | `\boxed{x=3}` | $\boxed{x=3}$ |
| binomial | `\binom{n}{k}` | $\binom{n}{k}$ |

## Aligned equations
```
\begin{aligned}
a &= b + c \\
  &= d
\end{aligned}
```
$$
\begin{aligned}
a &= b + c \\
  &= d
\end{aligned}
$$
