const express = require("express");
const {
  getEmailHistory,
  sendBulkMail,
  deleteEmailRecord,
} = require("../controllers/mailController");

const router = express.Router();

router.post("/send", sendBulkMail);
router.get("/history", getEmailHistory);
router.delete("/history/:id", deleteEmailRecord);

module.exports = router;
