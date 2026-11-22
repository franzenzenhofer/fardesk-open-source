import FardeskModels
@testable import FardeskStore
import FardeskTestDaemon
import Foundation
import Testing

/// Plan approval (feature `plan-approval`): the "Ready to code?" request, its choices and the answer route.
@MainActor
struct PlanApprovalTests {
    private func permission(planChoices: String? = nil, plan: String? = "# Plan\n\n- one\n- two", extra: String = "") throws -> PermissionActivity {
        var fields = [#""kind":"permission""#, #""id":"p1""#, #""ts":"2027-01-15T08:00:00.000Z""#, #""requestId":"r1""#, #""tool":"ExitPlanMode""#,
                      #""title":"Ready to code?""#, #""summary":"Plan""#, #""cwd":"/work/app""#, #""destructive":false"#, #""state":"pending""#]
        if let plan { fields.append(#""plan":\#(String(decoding: try JSONEncoder().encode(plan), as: UTF8.self))"#) }
        if let planChoices { fields.append(#""planChoices":\#(planChoices)"#) }
        if !extra.isEmpty { fields.append(extra) }
        let activity = try FardeskJSON.makeDecoder().decode(Activity.self, from: Data("{\(fields.joined(separator: ","))}".utf8))
        guard case .permission(let found) = activity else { throw PlanTestError.notAPermission }
        return found
    }

    private enum PlanTestError: Error { case notAPermission }

    @Test func aPlanRequestDecodesWithItsPlanChoicesAndUnknownExtraFields() throws {
        let found = try permission(planChoices: #"["approve_bypass","approve_manual","revise","future_choice"]"#, extra: #""somethingNew":{"a":[1,null]}"#)
        #expect(found.plan == "# Plan\n\n- one\n- two")
        #expect(found.planChoices == ["approve_bypass", "approve_manual", "revise", "future_choice"])
        #expect(found.tool == "ExitPlanMode" && found.state == .pending)
    }

    @Test func aPlainPermissionHasNoPlan() throws {
        let found = try permission(plan: nil)
        #expect(found.plan == nil && found.planChoices == nil && PlanPresentation(permission: found) == nil)
    }

    @Test func theChoicesComeInClaudeCodesOrderAndWords() throws {
        let all = try #require(PlanPresentation(permission: try permission(planChoices: #"["revise","approve_manual","approve_bypass"]"#)))
        #expect(all.choices.map(\.title) == ["Yes, and bypass permissions", "Yes, manually approve edits", "Tell Claude what to change"])
        #expect(all.choices.map(\.decision) == [.approveBypass, .approveManual, .revise])
        #expect(all.offersChoices)
        #expect(PermissionPresentation(permission: try permission(planChoices: #"["revise"]"#)).cardTitle == "Ready to code?")
    }

    @Test func bypassIsLeftOutWhenTheMachineDoesNotAllowIt() throws {
        let shown = try #require(PlanPresentation(permission: try permission(planChoices: #"["approve_manual","revise","unknown_new"]"#)))
        #expect(shown.choices == [.approveManual, .revise])
    }

    @Test func anOlderDaemonSendsNoChoicesSoTheCardFallsBackToAllowAndDeny() throws {
        let shown = try #require(PlanPresentation(permission: try permission()))
        #expect(shown.plan == "# Plan\n\n- one\n- two" && !shown.offersChoices && shown.choices.isEmpty)
    }

    @Test func theDecisionBodyCarriesTheMessageOnlyForRevise() throws {
        func body(_ decision: PermissionDecision, _ message: String?) throws -> [String: String] {
            let data = try JSONEncoder().encode(PermissionDecisionRequest(decision: decision, message: message))
            return try JSONDecoder().decode([String: String].self, from: data)
        }
        #expect(try body(.approveBypass, nil) == ["decision": "approve_bypass"])
        #expect(try body(.approveManual, nil) == ["decision": "approve_manual"])
        #expect(try body(.revise, "Split step 2") == ["decision": "revise", "message": "Split step 2"])
    }

    @Test func eachChoiceGoesToThePermissionRouteWithItsBody() async throws {
        try await DialogTests().withModel { model, server, ref in
            #expect(await model.decidePlan(ref, requestID: "r1", decision: .approveBypass))
            #expect(await model.decidePlan(ref, requestID: "r1", decision: .approveManual))
            #expect(await model.decidePlan(ref, requestID: "r1", decision: .revise, message: "Use SQLite"))
            let sent = server.requests.filter { $0.path == "/v1/sessions/s1/permission/r1" }
            #expect(sent.allSatisfy { $0.method == "POST" })
            let bodies = try sent.map { try JSONDecoder().decode([String: String].self, from: $0.body) }
            #expect(bodies == [
                ["decision": "approve_bypass"], ["decision": "approve_manual"], ["decision": "revise", "message": "Use SQLite"],
            ])
        }
    }

    @Test func aPendingPlanCountsAsNeedingApprovalLikeAnyPermission() throws {
        let found = try permission(planChoices: #"["approve_manual"]"#)
        #expect(Activity.permission(found).isPendingRequest)
        #expect(SessionAction.decide(.revise, on: found).requiresConfirmation == false)
    }
}
