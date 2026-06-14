// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('todo-form');
  const input = document.getElementById('todo-input');
  const list = document.getElementById('todo-list');

  // Load todos from localStorage
  let todos = JSON.parse(localStorage.getItem('todos')) || [];

  // Render all todos
  function render() {
    list.innerHTML = '';
    todos.forEach((todo, index) => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (todo.completed ? ' completed' : '');

      const span = document.createElement('span');
      span.textContent = todo.text;
      span.addEventListener('click', () => toggleCompleted(index));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTodo(index);
      });

      li.appendChild(span);
      li.appendChild(deleteBtn);
      list.appendChild(li);
    });
  }

  // Add a new todo
  function addTodo(text) {
    todos.push({ text: text.trim(), completed: false });
    saveAndRender();
  }

  // Toggle completed status
  function toggleCompleted(index) {
    todos[index].completed = !todos[index].completed;
    saveAndRender();
  }

  // Delete a todo
  function deleteTodo(index) {
    todos.splice(index, 1);
    saveAndRender();
  }

  // Save to localStorage and re-render
  function saveAndRender() {
    localStorage.setItem('todos', JSON.stringify(todos));
    render();
  }

  // Handle form submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text === '') return;
    addTodo(text);
    input.value = '';
    input.focus();
  });

  // Initial render
  render();
});
