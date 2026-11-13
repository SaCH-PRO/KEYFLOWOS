# Review transport evidence

`pr155-review-evidence.md` is the exact planned PR #155 conversation comment.
`issue80-progress.md` is the exact planned issue #80 PROGRESS. Their contents
bind source revisions and state the scope limits; neither grants merge
authority. The source report link uses the evidence branch because a file
cannot contain the hash of the commit that contains itself.

`progress-shape-result.json` records an offline run of unchanged main's
authority parser and directive selector against the complete collected
history, with the exact PROGRESS body appended synthetically. Its body hash
binds the check to the file. The diagnostic also changes only the message type
to REVIEW in a hypothetical copy, demonstrating why that transport would
replace the active H1 selection at this snapshot.

```bash
node check-progress-shape.mjs /path/to/pinned-main /path/to/comments.json issue80-progress.md /path/to/result.json
```

This script posts nothing. It does not certify that the live thread remained
unchanged after collection; publication must first refresh current revisions
and comments. The final published comment URLs belong to the GitHub thread,
not a manufactured admission record in this evidence package.
