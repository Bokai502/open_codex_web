import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { OutputLog } from "./OutputLog"

describe("OutputLog markdown rendering", () => {
  it("renders agent messages as markdown while leaving the current user prompt as plain text", () => {
    render(
      <OutputLog
        turns={[]}
        currentPrompt="# plain user"
        currentEvents={[
          {
            type: "item.completed",
            item: {
              id: "agent-1",
              type: "agent_message",
              text: ["# Agent heading", "", "- bullet"].join("\n"),
            },
          },
        ]}
        running={false}
        pendingAskUser={null}
        onSubmitAskUser={() => {}}
        onStopAskUser={() => {}}
      />
    )

    expect(screen.getByRole("heading", { level: 1, name: "Agent heading" })).toBeInTheDocument()
    expect(screen.getByText("# plain user")).toBeInTheDocument()
    expect(screen.getAllByRole("list")).toHaveLength(1)
  })

  it("renders live reasoning content as markdown", () => {
    const { container } = render(
      <OutputLog
        turns={[]}
        currentPrompt=""
        currentEvents={[
          {
            type: "item.started",
            item: {
              id: "reason-1",
              type: "reasoning",
              text: ["> note", "", "1. first"].join("\n"),
            },
          },
        ]}
        running={true}
        pendingAskUser={null}
        onSubmitAskUser={() => {}}
        onStopAskUser={() => {}}
      />
    )

    expect(container.querySelector("blockquote")).not.toBeNull()
    expect(screen.getByRole("list")).toHaveTextContent("first")
  })
})
