import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from langgraph.checkpoint.memory import MemorySaver

from src.agent import backend, main


class PersonalGroqTests(unittest.TestCase):
    def test_chat_request_normalizes_credentials_and_rejects_invalid_model(self):
        request = main.ChatRequest(
            message="Question",
            groq_api_key="  gsk-user-key  ",
            groq_model=" openai/gpt-oss-20b ",
        )
        self.assertEqual(request.groq_api_key, "gsk-user-key")
        self.assertEqual(request.groq_model, "openai/gpt-oss-20b")

        with self.assertRaises(ValueError):
            main.ChatRequest(message="Question", groq_model="model name")

    def test_provider_check_uses_key_without_returning_it(self):
        client = Mock()
        with patch.object(main, "Groq", return_value=client) as groq:
            result = main.check_provider(
                main.ProviderCheckRequest(
                    api_key="gsk-user-key", model="openai/gpt-oss-20b"
                )
            )

        groq.assert_called_once_with(api_key="gsk-user-key", timeout=20)
        client.chat.completions.create.assert_called_once()
        self.assertEqual(result, {"status": "ok"})
        self.assertNotIn("gsk-user-key", str(result))

    def test_chat_uses_personal_key_when_server_key_is_unset(self):
        with (
            patch.object(main.settings, "pinecone_api_key", "pinecone-test"),
            patch.object(main.settings, "groq_api_key", ""),
            patch.object(main, "inspect_image", return_value=""),
            patch.object(
                main.workflow,
                "invoke",
                return_value={"answer": "Answer", "kb": [], "web": [], "route": "answer"},
            ) as invoke,
        ):
            result = main.chat(
                main.ChatRequest(
                    message="Question",
                    groq_api_key="gsk-user-key",
                    groq_model="openai/gpt-oss-20b",
                )
            )

        self.assertEqual(result["answer"], "Answer")
        state = invoke.call_args.args[0]
        self.assertNotIn("groq_api_key", state)
        self.assertNotIn("groq_model", state)

    def test_chat_requires_a_model_for_a_personal_key(self):
        with (
            patch.object(main.settings, "pinecone_api_key", "pinecone-test"),
            patch.object(main, "inspect_image", return_value=""),
        ):
            with self.assertRaises(HTTPException) as error:
                main.chat(
                    main.ChatRequest(message="Question", groq_api_key="gsk-user-key")
                )

        self.assertEqual(error.exception.status_code, 422)

    def test_personal_key_is_not_in_graph_checkpoint(self):
        saver = MemorySaver()
        workflow = backend.g.compile(checkpointer=saver)
        config = {"configurable": {"thread_id": "personal-key-test"}}
        state = {
            "question": "Question",
            "history": [],
            "image_description": "",
            "kb": [],
            "web": [],
            "answer": "",
            "route": "",
        }

        with (
            patch.object(backend, "search_kb", return_value=[]),
            patch.object(backend.settings, "tavily_api_key", ""),
            patch.object(backend, "ChatGroq") as chat_groq,
            backend.provider_credentials("gsk-user-key", "openai/gpt-oss-20b"),
        ):
            chat_groq.return_value.invoke.return_value = Mock(content="Answer")
            workflow.invoke(state, config=config)

        chat_groq.assert_called_once()
        self.assertEqual(chat_groq.call_args.kwargs["api_key"], "gsk-user-key")
        self.assertEqual(chat_groq.call_args.kwargs["model"], "openai/gpt-oss-20b")
        checkpoint = workflow.get_state(config)
        self.assertNotIn("gsk-user-key", str(checkpoint.values))
        self.assertNotIn("groq_api_key", checkpoint.values)
        self.assertNotIn("groq_model", checkpoint.values)


if __name__ == "__main__":
    unittest.main()
