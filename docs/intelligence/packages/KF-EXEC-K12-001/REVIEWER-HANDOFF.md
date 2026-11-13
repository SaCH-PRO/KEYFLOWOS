# Kimi Code Adversarial Review — KF-EXEC-K12-001

Independently attempt to falsify the package.

## Required attacks
1. Can a candidate remove/rename a required test and still pass?
2. Can two tests share an ID and satisfy count/identity incorrectly?
3. Can skip/todo appear green?
4. Can setup/collection/unhandled errors disappear from verdict?
5. Can Turbo cache replay be misreported as fresh?
6. Can an unsafe DB/Redis/provider resource be touched before admission?
7. Can concurrent runs share schema/queue/port/resource state?
8. Can cleanup failure be ignored?
9. Can a candidate alter its own accepted manifest?
10. Can a child process survive and poison later runs?
11. Can source SHA/build mismatch be accepted?
12. Can malformed runner output default to success?

## Review output
For every objection provide:
- concrete file/function;
- failure sequence;
- invariant violated;
- exploitability of false-green proof;
- minimal correction;
- new negative control if needed.

Do not propose architecture changes unless the current package cannot express the correction.
