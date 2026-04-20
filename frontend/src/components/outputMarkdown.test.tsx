import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MarkdownText } from "./outputMarkdown"

describe("MarkdownText", () => {
  it("renders GFM markdown and local image paths", () => {
    render(
      <MarkdownText
        text={[
          "# Title",
          "",
          "- first",
          "- second",
          "",
          "```ts",
          'console.log("hi")',
          "```",
          "",
          "| a | b |",
          "| - | - |",
          "| 1 | 2 |",
          "",
          "C:\\tmp\\plot.png",
        ].join("\n")}
      />
    )

    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument()
    expect(screen.getByRole("list")).toHaveTextContent("first")
    expect(screen.getByText('console.log("hi")')).toBeInTheDocument()
    expect(screen.getByRole("table")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "C:\\tmp\\plot.png" })).toHaveAttribute(
      "src",
      "/api/image?path=C%3A%5Ctmp%5Cplot.png"
    )
  })

  it("does not turn raw html into DOM nodes", () => {
    const { container } = render(
      <MarkdownText text={["<script>alert('x')</script>", "", "safe"].join("\n")} />
    )

    expect(container.querySelector("script")).toBeNull()
    expect(screen.getByText("safe")).toBeInTheDocument()
  })
})
